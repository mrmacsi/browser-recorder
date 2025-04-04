#!/bin/bash

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    echo "Azure CLI is not installed. Please install it first."
    exit 1
fi

# Ensure user is logged in to Azure
az account show &> /dev/null || az login

# VM Size options
echo "Select Azure VM size:"
echo "B-series (Economical, burstable):"
echo "  1) Standard_B1s   - 1 vCPU, 1 GB RAM"
echo "  2) Standard_B1ms  - 1 vCPU, 2 GB RAM"
echo "  3) Standard_B2s   - 2 vCPU, 4 GB RAM"
echo "  4) Standard_B2ms  - 2 vCPU, 8 GB RAM"
echo "  5) Standard_B4ms  - 4 vCPU, 16 GB RAM"
echo "  6) Standard_B8ms  - 8 vCPU, 32 GB RAM"
echo "D-series (General Purpose):"
echo "  7) Standard_D2s_v3 - 2 vCPU, 8 GB RAM"
echo "  8) Standard_D4s_v3 - 4 vCPU, 16 GB RAM (recommended)"
echo "  9) Standard_D8s_v3 - 8 vCPU, 32 GB RAM"
echo " 10) Standard_D16s_v3 - 16 vCPU, 64 GB RAM"
echo "E-series (Memory Optimized):"
echo " 11) Standard_E2s_v3 - 2 vCPU, 16 GB RAM"
echo " 12) Standard_E4s_v3 - 4 vCPU, 32 GB RAM"
echo " 13) Standard_E8s_v3 - 8 vCPU, 64 GB RAM"
echo "F-series (Compute Optimized):"
echo " 14) Standard_F2s_v2 - 2 vCPU, 4 GB RAM"
echo " 15) Standard_F4s_v2 - 4 vCPU, 8 GB RAM"
echo " 16) Standard_F8s_v2 - 8 vCPU, 16 GB RAM"

read -p "Enter option number [8]: " vm_option

# Set VM Size based on selection (default to 8 - Standard_D4s_v3)
case ${vm_option:-8} in
    1) VM_SIZE="Standard_B1s" ;;
    2) VM_SIZE="Standard_B1ms" ;;
    3) VM_SIZE="Standard_B2s" ;;
    4) VM_SIZE="Standard_B2ms" ;;
    5) VM_SIZE="Standard_B4ms" ;;
    6) VM_SIZE="Standard_B8ms" ;;
    7) VM_SIZE="Standard_D2s_v3" ;;
    8) VM_SIZE="Standard_D4s_v3" ;;
    9) VM_SIZE="Standard_D8s_v3" ;;
    10) VM_SIZE="Standard_D16s_v3" ;;
    11) VM_SIZE="Standard_E2s_v3" ;;
    12) VM_SIZE="Standard_E4s_v3" ;;
    13) VM_SIZE="Standard_E8s_v3" ;;
    14) VM_SIZE="Standard_F2s_v2" ;;
    15) VM_SIZE="Standard_F4s_v2" ;;
    16) VM_SIZE="Standard_F8s_v2" ;;
    *) 
        echo "Invalid option, using default: Standard_D4s_v3"
        VM_SIZE="Standard_D4s_v3" 
        ;;
esac

echo "Using VM size: $VM_SIZE"

# Configuration variables - customize these as needed
RESOURCE_GROUP="browser-recorder-rg"
VM_NAME="browserrecordervm"
LOCATION="westeurope"
IMAGE="Canonical:0001-com-ubuntu-server-focal:20_04-lts:latest"  # Ubuntu 20.04 LTS
REPO_URL="https://github.com/mrmacsi/browser-recorder.git"  # Change to your Git repository URL

# Create resource group if it doesn't exist
echo "Creating resource group $RESOURCE_GROUP in $LOCATION..."
az group create --name "$RESOURCE_GROUP" --location "$LOCATION"
if [ $? -ne 0 ]; then
    echo "Failed to create resource group. Exiting."
    exit 1
fi

# Create the VM with specified size and Ubuntu image
echo "Creating VM $VM_NAME..."
az vm create \
    --resource-group "$RESOURCE_GROUP" \
    --name "$VM_NAME" \
    --size "$VM_SIZE" \
    --image "$IMAGE" \
    --admin-username azureuser \
    --generate-ssh-keys

if [ $? -ne 0 ]; then
    echo "Failed to create VM. Exiting."
    exit 1
fi

# Get the public IP address
PUBLIC_IP=$(az vm show -d -g "$RESOURCE_GROUP" -n "$VM_NAME" --query publicIps -o tsv)
echo "VM $VM_NAME created with public IP: $PUBLIC_IP"

# Wait for the VM to be fully provisioned
echo "Waiting for VM to be ready..."
sleep 30

# First step: Install required packages
echo "Installing required packages..."
az vm run-command invoke \
    --resource-group "$RESOURCE_GROUP" \
    --name "$VM_NAME" \
    --command-id RunShellScript \
    --scripts "sudo apt-get update && sudo apt-get install git nodejs npm -y"

if [ $? -ne 0 ]; then
    echo "Failed to install packages on VM."
    echo "You can SSH into the VM using: ssh azureuser@$PUBLIC_IP and complete setup manually."
    exit 1
fi

# Second step: Clone the repository
echo "Cloning repository $REPO_URL..."
CLONE_RESULT=$(az vm run-command invoke \
    --resource-group "$RESOURCE_GROUP" \
    --name "$VM_NAME" \
    --command-id RunShellScript \
    --scripts "git clone $REPO_URL /home/azureuser/project || echo 'Git clone failed'")

# Check if repository cloning was successful
if echo "$CLONE_RESULT" | grep -q "Git clone failed"; then
    echo "Failed to clone the repository. The repository might be private or inaccessible."
    echo "You can SSH into the VM using: ssh azureuser@$PUBLIC_IP and clone the repository manually."
    echo "VM creation was successful, but repository setup failed."
    exit 1
fi

# Final step: Run setup commands if everything is successful
echo "Running setup commands..."
az vm run-command invoke \
    --resource-group "$RESOURCE_GROUP" \
    --name "$VM_NAME" \
    --command-id RunShellScript \
    --scripts "cd /home/azureuser/project && if [ -f install.sh ]; then chmod +x install.sh && ./install.sh; fi && npm install"

echo "Setup complete. You can SSH into the VM using: ssh azureuser@$PUBLIC_IP"
echo "Your application is now running on VM: $VM_NAME" 
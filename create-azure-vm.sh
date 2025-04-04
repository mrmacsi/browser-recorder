#!/bin/bash

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    echo "Azure CLI is not installed. Please install it first."
    exit 1
fi

# Ensure user is logged in to Azure
az account show &> /dev/null || az login

# Configuration variables - customize these as needed
RESOURCE_GROUP="browser-recorder-rg"
VM_NAME="browserrecordervm"
LOCATION="westeurope"
VM_SIZE="Standard_B1s"  # 1 vCPU and 1 GiB RAM (tested and working)
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
#!/bin/bash

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    echo "Azure CLI is not installed. Please install it first."
    exit 1
fi

# Ensure user is logged in to Azure
az account show &> /dev/null || az login

# Configuration variables - customize these as needed
RESOURCE_GROUP="browser-recorder-vm-rg"
VM_NAME="browser-recorder-vm"
LOCATION="westeurope"
VM_SIZE="Standard_B1s"  # 1 vCPU and 1 GiB RAM (tested and working)
IMAGE="Canonical:0001-com-ubuntu-server-focal:20_04-lts:latest"  # Ubuntu 20.04 LTS
REPO_URL="https://github.com/macitsimsek12/sector-analytics-hub.git"  # Change to your Git repository URL

# Create resource group if it doesn't exist
if ! az group show --name "$RESOURCE_GROUP" &> /dev/null; then
    echo "Creating resource group $RESOURCE_GROUP in $LOCATION..."
    az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none
    if [ $? -ne 0 ]; then
        echo "Failed to create resource group. Exiting."
        exit 1
    fi
    echo "Resource group $RESOURCE_GROUP created."
else
    echo "Resource group $RESOURCE_GROUP already exists."
fi

# Create the VM with specified size and Ubuntu image
echo "Creating VM $VM_NAME..."
VM_CREATION=$(az vm create \
    --resource-group "$RESOURCE_GROUP" \
    --name "$VM_NAME" \
    --size "$VM_SIZE" \
    --image "$IMAGE" \
    --generate-ssh-keys \
    --public-ip-sku Standard 2>/dev/null)

if [ $? -ne 0 ]; then
    echo "Failed to create VM. Exiting."
    exit 1
fi

PUBLIC_IP=$(echo $VM_CREATION | jq -r .publicIpAddress)
echo "VM $VM_NAME created with public IP: $PUBLIC_IP"

# Wait for the VM to be fully provisioned
echo "Waiting for VM to be ready..."
sleep 30

# Run commands on the VM to install Node.js, Git, and pull code from the repository
echo "Installing software and pulling code from $REPO_URL..."
az vm run-command invoke \
    --resource-group "$RESOURCE_GROUP" \
    --name "$VM_NAME" \
    --command-id RunShellScript \
    --scripts "sudo apt-get update && sudo apt-get install git nodejs npm -y && git clone $REPO_URL /home/azureuser/project && cd /home/azureuser/project && chmod +x install.sh && ./install.sh && npm install"

if [ $? -ne 0 ]; then
    echo "Failed to run setup commands on VM. The VM was created but setup failed."
    echo "You can SSH into the VM using: ssh azureuser@$PUBLIC_IP and complete setup manually."
    exit 1
fi

echo "Setup complete. You can SSH into the VM using: ssh azureuser@$PUBLIC_IP"
echo "Your application is now running on VM: $VM_NAME" 
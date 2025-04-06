#!/bin/bash

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    echo "Azure CLI is not installed. Please install it first."
    exit 1
fi

# Ensure user is logged in to Azure
az account show &> /dev/null || az login

# Default resource group (same as in create-azure-vm.sh)
RESOURCE_GROUP="browser-recorder-rg"

# Function to list all VMs in the resource group
list_vms() {
    echo "Listing VMs in resource group: $RESOURCE_GROUP"
    echo "----------------------------------------------"
    az vm list \
        --resource-group "$RESOURCE_GROUP" \
        --show-details \
        --query "[].{Name:name, State:powerState, Size:hardwareProfile.vmSize, IP:publicIps, OS:storageProfile.osDisk.osType}" \
        --output table
    
    # Count VMs
    VM_COUNT=$(az vm list --resource-group "$RESOURCE_GROUP" --query "length(@)")
    echo "Total VMs: $VM_COUNT"
}

# Function to delete a VM and associated resources
delete_vm() {
    if [ -z "$1" ]; then
        echo "Error: VM name is required."
        echo "Usage: $0 delete <vm-name>"
        return 1
    fi
    
    VM_NAME="$1"
    
    # Check if VM exists
    if ! az vm show --resource-group "$RESOURCE_GROUP" --name "$VM_NAME" --query "name" -o tsv &>/dev/null; then
        echo "Error: VM '$VM_NAME' not found in resource group '$RESOURCE_GROUP'."
        return 1
    fi
    
    # Ask for confirmation
    read -p "Are you sure you want to delete VM '$VM_NAME'? This will remove all associated resources. (y/n): " confirm
    if [[ $confirm != [yY] && $confirm != [yY][eE][sS] ]]; then
        echo "VM deletion cancelled."
        return 0
    fi
    
    echo "Deleting VM '$VM_NAME' and associated resources..."
    az vm delete \
        --resource-group "$RESOURCE_GROUP" \
        --name "$VM_NAME" \
        --yes
    
    echo "VM '$VM_NAME' has been deleted successfully."
}

# Function to delete all VMs in the resource group
delete_all_vms() {
    # Check if there are any VMs in the resource group
    VM_COUNT=$(az vm list --resource-group "$RESOURCE_GROUP" --query "length(@)")
    
    if [ "$VM_COUNT" -eq 0 ]; then
        echo "No VMs found in resource group '$RESOURCE_GROUP'."
        return 0
    fi
    
    # Ask for confirmation
    read -p "Are you sure you want to delete ALL ($VM_COUNT) VMs in resource group '$RESOURCE_GROUP'? (y/n): " confirm
    if [[ $confirm != [yY] && $confirm != [yY][eE][sS] ]]; then
        echo "VM deletion cancelled."
        return 0
    fi
    
    echo "Deleting all VMs in resource group '$RESOURCE_GROUP'..."
    
    # Get all VM names and delete them one by one
    VM_NAMES=$(az vm list --resource-group "$RESOURCE_GROUP" --query "[].name" -o tsv)
    for VM_NAME in $VM_NAMES; do
        echo "Deleting VM: $VM_NAME"
        az vm delete \
            --resource-group "$RESOURCE_GROUP" \
            --name "$VM_NAME" \
            --yes
        
        echo "VM '$VM_NAME' has been deleted."
    done
    
    echo "All VMs have been deleted from resource group '$RESOURCE_GROUP'."
}

# Main script execution
case "$1" in
    "list")
        list_vms
        ;;
    "delete")
        delete_vm "$2"
        ;;
    "delete-all")
        delete_all_vms
        ;;
    *)
        echo "Azure VM Management Tool"
        echo "------------------------"
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  list                 List all VMs in the resource group"
        echo "  delete <vm-name>     Delete a specific VM and its resources"
        echo "  delete-all           Delete all VMs in the resource group"
        echo ""
        echo "Example:"
        echo "  $0 list              # List all VMs"
        echo "  $0 delete myvm       # Delete VM named 'myvm'"
        ;;
esac

exit 0

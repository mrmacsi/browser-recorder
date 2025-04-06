#!/bin/bash

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    echo "Azure CLI is not installed. Please install it first."
    exit 1
fi

# Ensure user is logged in to Azure
az account show &> /dev/null || az login

# Default resource group
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

# Function to list all resources in the resource group
list_resources() {
    echo "Listing all resources in resource group: $RESOURCE_GROUP"
    echo "-------------------------------------------------------"
    az resource list \
        --resource-group "$RESOURCE_GROUP" \
        --query "[].{Name:name, Type:type, Location:location}" \
        --output table
}

# Function to get all resources related to a VM
get_vm_resources() {
    VM_NAME="$1"
    
    # Get NIC IDs associated with the VM
    NIC_IDS=$(az vm show \
        --resource-group "$RESOURCE_GROUP" \
        --name "$VM_NAME" \
        --query "networkProfile.networkInterfaces[].id" \
        --output tsv)
    
    # Get OS disk ID
    OS_DISK_ID=$(az vm show \
        --resource-group "$RESOURCE_GROUP" \
        --name "$VM_NAME" \
        --query "storageProfile.osDisk.managedDisk.id" \
        --output tsv)
    
    # Get data disk IDs
    DATA_DISK_IDS=$(az vm show \
        --resource-group "$RESOURCE_GROUP" \
        --name "$VM_NAME" \
        --query "storageProfile.dataDisks[].managedDisk.id" \
        --output tsv)
    
    # Get Public IP IDs and NSG IDs from NICs
    PUBLIC_IP_IDS=""
    NSG_IDS=""
    
    for NIC_ID in $NIC_IDS; do
        NIC_NAME=$(echo $NIC_ID | awk -F/ '{print $NF}')
        
        # Get Public IP ID from NIC
        IP_ID=$(az network nic show \
            --ids "$NIC_ID" \
            --query "ipConfigurations[].publicIpAddress.id" \
            --output tsv)
        
        if [ -n "$IP_ID" ]; then
            PUBLIC_IP_IDS+="$IP_ID "
        fi
        
        # Get NSG ID from NIC
        NSG_ID=$(az network nic show \
            --ids "$NIC_ID" \
            --query "networkSecurityGroup.id" \
            --output tsv)
        
        if [ -n "$NSG_ID" ]; then
            NSG_IDS+="$NSG_ID "
        fi
    done
    
    # Return all resource IDs as space-separated string
    echo "$NIC_IDS $OS_DISK_ID $DATA_DISK_IDS $PUBLIC_IP_IDS $NSG_IDS"
}

# Function to delete a VM and all associated resources
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
    
    echo "Getting all resources associated with VM '$VM_NAME'..."
    VM_RESOURCES=$(get_vm_resources "$VM_NAME")
    
    echo "Deleting VM '$VM_NAME'..."
    az vm delete \
        --resource-group "$RESOURCE_GROUP" \
        --name "$VM_NAME" \
        --yes
    
    echo "Cleaning up associated resources..."
    
    # Delete each resource separately
    for RESOURCE_ID in $VM_RESOURCES; do
        if [ -n "$RESOURCE_ID" ]; then
            echo "Deleting resource: $(echo $RESOURCE_ID | awk -F/ '{print $NF}')"
            az resource delete --ids "$RESOURCE_ID" --verbose || echo "Warning: Could not delete $RESOURCE_ID"
        fi
    done
    
    echo "VM '$VM_NAME' and all associated resources have been deleted successfully."
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
        echo "Processing VM: $VM_NAME"
        delete_vm "$VM_NAME"
    done
    
    echo "All VMs and associated resources have been deleted from resource group '$RESOURCE_GROUP'."
}

# Function to find orphaned resources
find_orphaned_resources() {
    echo "Checking for potentially orphaned resources in '$RESOURCE_GROUP'..."
    
    # Get all VM names
    VM_NAMES=$(az vm list --resource-group "$RESOURCE_GROUP" --query "[].name" -o tsv)
    
    # Find all NICs that might not be attached to VMs
    echo "Checking for orphaned NICs..."
    ORPHANED_NICS=$(az network nic list --resource-group "$RESOURCE_GROUP" --query "[?virtualMachine==null].name" -o tsv)
    
    # Find all public IPs that might not be attached to NICs
    echo "Checking for orphaned Public IPs..."
    ORPHANED_IPS=$(az network public-ip list --resource-group "$RESOURCE_GROUP" --query "[?ipConfiguration==null].name" -o tsv)
    
    # Find all NSGs that might not be attached to NICs or subnets
    echo "Checking for orphaned NSGs..."
    ORPHANED_NSGS=$(az network nsg list --resource-group "$RESOURCE_GROUP" --query "[?networkInterfaces==[] && subnets==[]] || [?networkInterfaces==null && subnets==null].name" -o tsv)
    
    # Find all disks that might not be attached to VMs
    echo "Checking for orphaned Disks..."
    ORPHANED_DISKS=$(az disk list --resource-group "$RESOURCE_GROUP" --query "[?managedBy==null].name" -o tsv)
    
    # Find all Virtual Networks
    echo "Checking for Virtual Networks..."
    VNETS=$(az network vnet list --resource-group "$RESOURCE_GROUP" --query "[].name" -o tsv)
    
    # Display results
    echo -e "\nOrphaned Resources:"
    echo "-------------------"
    
    if [ -n "$ORPHANED_NICS" ]; then
        echo "NICs without VMs:"
        echo "$ORPHANED_NICS" | while read NIC; do echo "  - $NIC"; done
    else
        echo "No orphaned NICs found."
    fi
    
    if [ -n "$ORPHANED_IPS" ]; then
        echo "Public IPs without NICs:"
        echo "$ORPHANED_IPS" | while read IP; do echo "  - $IP"; done
    else
        echo "No orphaned Public IPs found."
    fi
    
    if [ -n "$ORPHANED_NSGS" ]; then
        echo "NSGs without NICs or subnets:"
        echo "$ORPHANED_NSGS" | while read NSG; do echo "  - $NSG"; done
    else
        echo "No orphaned NSGs found."
    fi
    
    if [ -n "$ORPHANED_DISKS" ]; then
        echo "Disks without VMs:"
        echo "$ORPHANED_DISKS" | while read DISK; do echo "  - $DISK"; done
    else
        echo "No orphaned Disks found."
    fi
    
    if [ -n "$VNETS" ]; then
        echo "Virtual Networks (may be shared resources):"
        echo "$VNETS" | while read VNET; do echo "  - $VNET"; done
    else
        echo "No Virtual Networks found."
    fi
}

# Function to clean up orphaned resources
cleanup_orphaned_resources() {
    # Ask for confirmation
    read -p "Are you sure you want to delete ALL orphaned resources in '$RESOURCE_GROUP'? (y/n): " confirm
    if [[ $confirm != [yY] && $confirm != [yY][eE][sS] ]]; then
        echo "Cleanup cancelled."
        return 0
    fi
    
    # Clean up orphaned NICs
    ORPHANED_NICS=$(az network nic list --resource-group "$RESOURCE_GROUP" --query "[?virtualMachine==null].name" -o tsv)
    for NIC in $ORPHANED_NICS; do
        echo "Deleting orphaned NIC: $NIC"
        az network nic delete --resource-group "$RESOURCE_GROUP" --name "$NIC"
    done
    
    # Clean up orphaned public IPs
    ORPHANED_IPS=$(az network public-ip list --resource-group "$RESOURCE_GROUP" --query "[?ipConfiguration==null].name" -o tsv)
    for IP in $ORPHANED_IPS; do
        echo "Deleting orphaned Public IP: $IP"
        az network public-ip delete --resource-group "$RESOURCE_GROUP" --name "$IP"
    done
    
    # Clean up orphaned NSGs
    ORPHANED_NSGS=$(az network nsg list --resource-group "$RESOURCE_GROUP" --query "[?networkInterfaces==[] && subnets==[]] || [?networkInterfaces==null && subnets==null].name" -o tsv)
    for NSG in $ORPHANED_NSGS; do
        echo "Deleting orphaned NSG: $NSG"
        az network nsg delete --resource-group "$RESOURCE_GROUP" --name "$NSG"
    done
    
    # Clean up orphaned disks
    ORPHANED_DISKS=$(az disk list --resource-group "$RESOURCE_GROUP" --query "[?managedBy==null].name" -o tsv)
    for DISK in $ORPHANED_DISKS; do
        echo "Deleting orphaned Disk: $DISK"
        az disk delete --resource-group "$RESOURCE_GROUP" --name "$DISK" --yes
    done
    
    # Ask about Virtual Networks - these could be shared resources
    VNETS=$(az network vnet list --resource-group "$RESOURCE_GROUP" --query "[].name" -o tsv)
    if [ -n "$VNETS" ]; then
        echo -e "\nVirtual Networks found:"
        echo "$VNETS" | while read VNET; do echo "  - $VNET"; done
        
        read -p "Do you want to delete ALL Virtual Networks? This could affect other resources. (y/n): " confirm_vnet
        if [[ $confirm_vnet == [yY] || $confirm_vnet == [yY][eE][sS] ]]; then
            for VNET in $VNETS; do
                echo "Deleting Virtual Network: $VNET"
                # First delete all subnets in the VNET
                SUBNETS=$(az network vnet subnet list --resource-group "$RESOURCE_GROUP" --vnet-name "$VNET" --query "[].name" -o tsv)
                for SUBNET in $SUBNETS; do
                    echo "  Deleting subnet: $SUBNET in VNET: $VNET"
                    az network vnet subnet delete --resource-group "$RESOURCE_GROUP" --vnet-name "$VNET" --name "$SUBNET"
                done
                
                # Then delete the VNET
                az network vnet delete --resource-group "$RESOURCE_GROUP" --name "$VNET"
            done
        else
            echo "Skipping deletion of Virtual Networks."
        fi
    fi
    
    echo "Orphaned resource cleanup completed."
}

# Function to clean up everything in the resource group
cleanup_everything() {
    echo "This will delete EVERY resource in the resource group: $RESOURCE_GROUP"
    echo "WARNING: This is a destructive operation and cannot be undone."
    read -p "Are you absolutely sure you want to continue? (y/n): " confirm
    if [[ $confirm != [yY] && $confirm != [yY][eE][sS] ]]; then
        echo "Operation cancelled."
        return 0
    fi
    
    # Double-check
    read -p "Last chance: Are you REALLY sure? All resources will be deleted. (yes/no): " final_confirm
    if [[ $final_confirm != "yes" ]]; then
        echo "Operation cancelled."
        return 0
    fi
    
    echo "Deleting ALL resources in resource group: $RESOURCE_GROUP"
    
    # Delete VMs first (to avoid dependency issues)
    VM_NAMES=$(az vm list --resource-group "$RESOURCE_GROUP" --query "[].name" -o tsv)
    for VM_NAME in $VM_NAMES; do
        echo "Deleting VM: $VM_NAME"
        az vm delete --resource-group "$RESOURCE_GROUP" --name "$VM_NAME" --yes
    done
    
    # Delete all remaining resources by type
    
    # Delete NICs
    NICS=$(az network nic list --resource-group "$RESOURCE_GROUP" --query "[].name" -o tsv)
    for NIC in $NICS; do
        echo "Deleting NIC: $NIC"
        az network nic delete --resource-group "$RESOURCE_GROUP" --name "$NIC"
    done
    
    # Delete Public IPs
    IPS=$(az network public-ip list --resource-group "$RESOURCE_GROUP" --query "[].name" -o tsv)
    for IP in $IPS; do
        echo "Deleting Public IP: $IP"
        az network public-ip delete --resource-group "$RESOURCE_GROUP" --name "$IP"
    done
    
    # Delete NSGs
    NSGS=$(az network nsg list --resource-group "$RESOURCE_GROUP" --query "[].name" -o tsv)
    for NSG in $NSGS; do
        echo "Deleting NSG: $NSG"
        az network nsg delete --resource-group "$RESOURCE_GROUP" --name "$NSG"
    done
    
    # Delete Virtual Networks (delete subnets first)
    VNETS=$(az network vnet list --resource-group "$RESOURCE_GROUP" --query "[].name" -o tsv)
    for VNET in $VNETS; do
        # Delete all subnets in the VNET
        SUBNETS=$(az network vnet subnet list --resource-group "$RESOURCE_GROUP" --vnet-name "$VNET" --query "[].name" -o tsv)
        for SUBNET in $SUBNETS; do
            echo "Deleting subnet: $SUBNET in VNET: $VNET"
            az network vnet subnet delete --resource-group "$RESOURCE_GROUP" --vnet-name "$VNET" --name "$SUBNET"
        done
        
        # Then delete the VNET
        echo "Deleting VNET: $VNET"
        az network vnet delete --resource-group "$RESOURCE_GROUP" --name "$VNET"
    done
    
    # Delete Disks
    DISKS=$(az disk list --resource-group "$RESOURCE_GROUP" --query "[].name" -o tsv)
    for DISK in $DISKS; do
        echo "Deleting Disk: $DISK"
        az disk delete --resource-group "$RESOURCE_GROUP" --name "$DISK" --yes
    done
    
    echo "All resources in resource group '$RESOURCE_GROUP' have been deleted."
}

# Main script execution
case "$1" in
    "list")
        list_vms
        ;;
    "list-resources")
        list_resources
        ;;
    "delete")
        delete_vm "$2"
        ;;
    "delete-all")
        delete_all_vms
        ;;
    "find-orphans")
        find_orphaned_resources
        ;;
    "cleanup-orphans")
        find_orphaned_resources
        cleanup_orphaned_resources
        ;;
    "nuke-all")
        cleanup_everything
        ;;
    *)
        echo "Azure VM Management Tool"
        echo "------------------------"
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  list                 List all VMs in the resource group"
        echo "  list-resources       List all resources in the resource group"
        echo "  delete <vm-name>     Delete a specific VM and ALL its resources"
        echo "  delete-all           Delete all VMs and their resources"
        echo "  find-orphans         Find orphaned resources not attached to any VM"
        echo "  cleanup-orphans      Find and delete all orphaned resources"
        echo "  nuke-all             Delete EVERYTHING in the resource group"
        echo ""
        echo "Example:"
        echo "  $0 list              # List all VMs"
        echo "  $0 delete myvm       # Delete VM named 'myvm' and all its resources"
        echo "  $0 find-orphans      # Find orphaned resources"
        echo "  $0 nuke-all          # Delete all resources in the resource group"
        ;;
esac

exit 0
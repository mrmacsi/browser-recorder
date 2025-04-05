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
echo "  1) Standard_B1s   - 1 vCPU, 1 GB RAM    - Low-cost, minimal testing only"
echo "  2) Standard_B1ms  - 1 vCPU, 2 GB RAM    - Basic dev/test environments"
echo "  3) Standard_B2s   - 2 vCPU, 4 GB RAM    - Light development workloads"
echo "  4) Standard_B2ms  - 2 vCPU, 8 GB RAM    - Development with occasional recording"
echo "  5) Standard_B4ms  - 4 vCPU, 16 GB RAM   - Variable workloads, cost-optimized"
echo "  6) Standard_B8ms  - 8 vCPU, 32 GB RAM   - Larger variable workloads, cost-optimized"
echo "D-series (General Purpose):"
echo "  7) Standard_D2s_v3 - 2 vCPU, 8 GB RAM   - Entry-level production, limited concurrent sessions"
echo "  8) Standard_D4s_v3 - 4 vCPU, 16 GB RAM  - RECOMMENDED: Balanced performance for production"
echo "  9) Standard_D8s_v3 - 8 vCPU, 32 GB RAM  - Multiple concurrent recording sessions"
echo " 10) Standard_D16s_v3 - 16 vCPU, 64 GB RAM - High throughput, many concurrent sessions"
echo "F-series (Compute Optimized):"
echo " 11) Standard_F2s_v2 - 2 vCPU, 4 GB RAM   - CPU-intensive recording, lower memory needs"
echo " 12) Standard_F4s_v2 - 4 vCPU, 8 GB RAM   - Fast processing for CPU-bound recording"
echo " 13) Standard_F8s_v2 - 8 vCPU, 16 GB RAM  - High-performance encoding and processing"
echo " 14) Standard_F16s_v2- 16 vCPU, 32 GB RAM - Maximum performance for heavy workloads"
echo "GPU-accelerated (NV-series):"
echo " 15) Standard_NV6    - 6 vCPU, 56 GB RAM  - NVIDIA Tesla M60 GPU for hardware acceleration"
echo "E-series (Memory Optimized):"
echo " 16) Standard_E2s_v3 - 2 vCPU, 16 GB RAM  - Memory-intensive recording of complex sites"
echo " 17) Standard_E4s_v3 - 4 vCPU, 32 GB RAM  - High-resolution recordings with memory demands"
echo " 18) Standard_E8s_v3 - 8 vCPU, 64 GB RAM  - Heavy memory workloads, data processing"
echo ""
echo "PRICING & PERFORMANCE NOTES:"
echo "- B-series: 30-40% cheaper, but variable performance (CPU credits/bursting)"
echo "- D-series: Consistent performance ideal for reliable recording services"
echo "- F-series: Best price/performance for video processing and rendering (RECOMMENDED)"
echo "- NV-series: Highest performance with GPU acceleration, but more expensive"
echo "- E-series: Double the memory of D-series for complex web applications"
echo "- The 's' suffix indicates premium storage support for all options"

read -p "Enter option number [12]: " vm_option

# Set VM Size based on selection (default to 12 - Standard_F4s_v2)
case ${vm_option:-12} in
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
    11) VM_SIZE="Standard_F2s_v2" ;;
    12) VM_SIZE="Standard_F4s_v2" ;;
    13) VM_SIZE="Standard_F8s_v2" ;;
    14) VM_SIZE="Standard_F16s_v2" ;;
    15) VM_SIZE="Standard_NV6" ;;
    16) VM_SIZE="Standard_E2s_v3" ;;
    17) VM_SIZE="Standard_E4s_v3" ;;
    18) VM_SIZE="Standard_E8s_v3" ;;
    *) 
        echo "Invalid option, using default: Standard_F4s_v2"
        VM_SIZE="Standard_F4s_v2" 
        ;;
esac

echo "Using VM size: $VM_SIZE"

# Configuration variables - customize these as needed
RESOURCE_GROUP="browser-recorder-rg"
VM_NAME="browserrecordervm"
LOCATION="westeurope"
IMAGE="Canonical:0001-com-ubuntu-server-focal:20_04-lts:latest"  # Ubuntu 20.04 LTS
REPO_URL="https://github.com/mrmacsi/browser-recorder.git"  # Change to your Git repository URL

# Extract the core count from the VM size
CORE_COUNT=0
case "$VM_SIZE" in
    Standard_B1s|Standard_B1ms) CORE_COUNT=1 ;;
    Standard_B2s|Standard_B2ms|Standard_D2s_v3|Standard_E2s_v3|Standard_F2s_v2) CORE_COUNT=2 ;;
    Standard_B4ms|Standard_D4s_v3|Standard_E4s_v3|Standard_F4s_v2) CORE_COUNT=4 ;;
    Standard_B8ms|Standard_D8s_v3|Standard_E8s_v3|Standard_F8s_v2) CORE_COUNT=8 ;;
    Standard_D16s_v3|Standard_F16s_v2) CORE_COUNT=16 ;;
    Standard_NV6) CORE_COUNT=6 ;;
    *) CORE_COUNT=4 ;;  # Default assumption
esac

# Check subscription quota for the selected location and VM size
echo "Checking your subscription quota for cores in $LOCATION..."
QUOTA_INFO=$(az vm list-usage --location "$LOCATION" --query "[?name.value=='cores']" -o json)
CURRENT_USAGE=$(echo $QUOTA_INFO | jq -r '.[0].currentValue')
QUOTA_LIMIT=$(echo $QUOTA_INFO | jq -r '.[0].limit')

echo "Current core usage: $CURRENT_USAGE"
echo "Core quota limit: $QUOTA_LIMIT"
echo "Required cores for $VM_SIZE: $CORE_COUNT"

# Check if we have enough quota
if (( CORE_COUNT > QUOTA_LIMIT )); then
    echo "ERROR: Your subscription does not have enough core quota to create this VM."
    echo "You need at least $CORE_COUNT cores, but your limit is $QUOTA_LIMIT cores."
    echo ""
    echo "You have the following options:"
    echo "1. Request a quota increase from Azure portal"
    echo "2. Try a different Azure region that might have higher quota"
    echo "3. Select a smaller VM size that fits within your quota"
    echo ""
    
    # Check quotas in other popular regions
    echo "Checking quotas in other Azure regions..."
    declare -a REGIONS=("eastus" "westus2" "northeurope" "southeastasia" "australiaeast" "centralus" "uksouth")
    
    echo "Region availability for $VM_SIZE VM:"
    for region in "${REGIONS[@]}"; do
        if [ "$region" != "$LOCATION" ]; then
            region_quota=$(az vm list-usage --location "$region" --query "[?name.value=='cores']" -o tsv | awk '{print $3}')
            if [ -n "$region_quota" ] && (( region_quota >= CORE_COUNT )); then
                echo "✅ $region - Available! (Quota: $region_quota cores)"
            else
                echo "❌ $region - Not enough quota (Limit: $region_quota cores)"
            fi
        fi
    done
    
    echo ""
    echo "Select an option:"
    echo "1) Request a quota increase in $LOCATION (takes 1-3 business days)"
    echo "2) Try creating VM in a different region"
    echo "3) Choose a smaller VM size"
    read -p "Enter your choice [1-3]: " QUOTA_CHOICE
    
    case $QUOTA_CHOICE in
        1)
            echo ""
            echo "To request a quota increase:"
            echo "1. Visit: https://aka.ms/ProdportalCRP/#blade/Microsoft_Azure_Capacity/UsageAndQuota.ReactView"
            echo "2. Select your subscription"
            echo "3. Click 'Request increase' at the top"
            echo "4. Choose 'Compute-VM (cores-vCPU) subscription limit increases'"
            echo "5. Select '$LOCATION' region and request at least $CORE_COUNT cores"
            echo ""
            echo "The approval process typically takes 1-3 business days."
            echo "After your quota increase is approved, run this script again."
            echo ""
            read -p "Press Enter to exit..."
            exit 0
            ;;
            
        2)
            echo ""
            echo "Select a new region with sufficient quota:"
            count=1
            declare -a AVAILABLE_REGIONS=()
            
            for region in "${REGIONS[@]}"; do
                if [ "$region" != "$LOCATION" ]; then
                    region_quota=$(az vm list-usage --location "$region" --query "[?name.value=='cores']" -o tsv | awk '{print $3}')
                    if [ -n "$region_quota" ] && (( region_quota >= CORE_COUNT )); then
                        AVAILABLE_REGIONS+=("$region")
                        echo "$count) $region (Quota: $region_quota cores)"
                        count=$((count+1))
                    fi
                fi
            done
            
            if [ ${#AVAILABLE_REGIONS[@]} -eq 0 ]; then
                echo "No regions with sufficient quota found. Please request a quota increase."
                echo "Visit: https://aka.ms/ProdportalCRP/#blade/Microsoft_Azure_Capacity/UsageAndQuota.ReactView"
                exit 1
            fi
            
            read -p "Select region number [1-$((count-1))]: " REGION_CHOICE
            if [ "$REGION_CHOICE" -ge 1 ] && [ "$REGION_CHOICE" -lt "$count" ]; then
                LOCATION=${AVAILABLE_REGIONS[$((REGION_CHOICE-1))]}
                echo "Selected region: $LOCATION"
            else
                echo "Invalid selection. Exiting."
                exit 1
            fi
            ;;
            
        3)
            echo ""
            echo "Select a VM size that fits within your quota ($QUOTA_LIMIT cores):"
            
            if (( QUOTA_LIMIT >= 8 )); then
                echo "1) Standard_F8s_v2 - 8 vCPUs, 16 GB RAM - High performance computing"
                echo "2) Standard_D8s_v3 - 8 vCPUs, 32 GB RAM - Balanced performance"
                echo "3) Standard_NV6    - 6 vCPUs, 56 GB RAM - GPU accelerated (NVIDIA Tesla M60)"
                read -p "Select VM size [1-3]: " SIZE_CHOICE
                
                case $SIZE_CHOICE in
                    1) VM_SIZE="Standard_F8s_v2"; CORE_COUNT=8 ;;
                    2) VM_SIZE="Standard_D8s_v3"; CORE_COUNT=8 ;;
                    3) VM_SIZE="Standard_NV6"; CORE_COUNT=6 ;;
                    *) VM_SIZE="Standard_F8s_v2"; CORE_COUNT=8 ;;
                esac
                
            elif (( QUOTA_LIMIT >= 4 )); then
                echo "1) Standard_F4s_v2 - 4 vCPUs, 8 GB RAM - High performance computing"
                echo "2) Standard_D4s_v3 - 4 vCPUs, 16 GB RAM - Balanced performance"
                read -p "Select VM size [1-2]: " SIZE_CHOICE
                
                case $SIZE_CHOICE in
                    1) VM_SIZE="Standard_F4s_v2"; CORE_COUNT=4 ;;
                    2) VM_SIZE="Standard_D4s_v3"; CORE_COUNT=4 ;;
                    *) VM_SIZE="Standard_F4s_v2"; CORE_COUNT=4 ;;
                esac
                
            else
                echo "Your quota is too low for optimal performance. Consider requesting an increase."
                echo "For now, we'll use the largest available size:"
                VM_SIZE="Standard_F2s_v2"
                CORE_COUNT=2
            fi
            
            echo "Selected VM size: $VM_SIZE ($CORE_COUNT cores)"
            ;;
            
        *)
            echo "Invalid option. Exiting."
            exit 1
            ;;
    esac
fi

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
    --generate-ssh-keys \
    --public-ip-sku Standard \
    --nsg-rule SSH \
    --storage-sku Premium_LRS \
    --os-disk-size-gb 128 \
    --os-disk-caching ReadWrite

if [ $? -ne 0 ]; then
    echo "Failed to create VM. Exiting."
    exit 1
fi

# Configure VM for optimal performance
echo "Configuring VM for optimal video processing performance..."
az vm run-command invoke \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME" \
  --command-id RunShellScript \
  --scripts "sudo sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf"

# Get the public IP address
PUBLIC_IP=$(az vm show -d -g "$RESOURCE_GROUP" -n "$VM_NAME" --query publicIps -o tsv)
echo "VM $VM_NAME created with public IP: $PUBLIC_IP"

# Open port 5001 for HTTP browser recorder service
echo "Opening port 5001 for HTTP browser recorder service..."
az network nsg rule create \
    --resource-group "$RESOURCE_GROUP" \
    --nsg-name "${VM_NAME}NSG" \
    --name BrowserRecorderHTTP \
    --protocol tcp \
    --priority 1001 \
    --destination-port-range 5001 \
    --access allow

# Open port 5443 for HTTPS browser recorder service
echo "Opening port 5443 for HTTPS browser recorder service..."
az network nsg rule create \
    --resource-group "$RESOURCE_GROUP" \
    --nsg-name "${VM_NAME}NSG" \
    --name BrowserRecorderHTTPS \
    --protocol tcp \
    --priority 1002 \
    --destination-port-range 5443 \
    --access allow

if [ $? -ne 0 ]; then
    echo "Failed to open ports. You may need to open them manually."
    echo "Run the following commands to open the ports:"
    echo "az network nsg rule create --resource-group $RESOURCE_GROUP --nsg-name ${VM_NAME}NSG --name BrowserRecorderHTTP --protocol tcp --priority 1001 --destination-port-range 5001 --access allow"
    echo "az network nsg rule create --resource-group $RESOURCE_GROUP --nsg-name ${VM_NAME}NSG --name BrowserRecorderHTTPS --protocol tcp --priority 1002 --destination-port-range 5443 --access allow"
fi

# Wait for the VM to be fully provisioned
echo "Waiting for VM to be ready..."
sleep 30

# First step: Install required packages
echo "Installing required packages..."
az vm run-command invoke \
    --resource-group "$RESOURCE_GROUP" \
    --name "$VM_NAME" \
    --command-id RunShellScript \
    --scripts "sudo apt-get update && sudo apt-get install git nodejs npm openssl -y"

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
    --scripts "cd /home/azureuser/project && if [ -f install.sh ]; then chmod +x install.sh && ./install.sh; fi"

echo "Verifying the service is running correctly..."
az vm run-command invoke \
    --resource-group "$RESOURCE_GROUP" \
    --name "$VM_NAME" \
    --command-id RunShellScript \
    --scripts "curl -s http://localhost:5001/api/health || echo 'HTTP health check failed' && curl -s -k https://localhost:5443/api/health || echo 'HTTPS health check failed'"

echo "Setup complete. You can SSH into the VM using: ssh azureuser@$PUBLIC_IP"
echo "Your application is running at:"
echo "  - HTTP: http://$PUBLIC_IP:5001"
echo "  - HTTPS: https://$PUBLIC_IP:5443"
echo ""
echo "API endpoints:"
echo "  - GET http://$PUBLIC_IP:5001/api/health or https://$PUBLIC_IP:5443/api/health - Check service health"
echo "  - POST http://$PUBLIC_IP:5001/api/record or https://$PUBLIC_IP:5443/api/record - Record a website"
echo "  - GET http://$PUBLIC_IP:5001/api/files or https://$PUBLIC_IP:5443/api/files - List recordings"
echo "  - GET http://$PUBLIC_IP:5001/uploads/[filename] or https://$PUBLIC_IP:5443/uploads/[filename] - Access recorded videos"
echo ""
echo "NOTE: Since we're using a self-signed certificate, browsers will show a security warning when using HTTPS."
echo "You can proceed by accepting the risk or exception in your browser." 
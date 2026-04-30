# Messaging Explorer

> **Universal messaging platform explorer and management tool**

A modern, cross-platform desktop application for managing and exploring messages across multiple messaging platforms. Built with Angular, Electron, and .NET.

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## Features

- 🚀 **Multi-Platform Support**: Connect to multiple messaging platforms from a single interface
- 💻 **Cross-Platform**: Available for Windows, macOS, and Linux
- 🎨 **Modern UI**: Clean, intuitive interface with dark/light theme support
- ⚡ **Real-time Monitoring**: Live message tracking and monitoring
- 🔍 **Advanced Search**: Powerful search and filtering capabilities
- 📊 **Message Analytics**: Visualize message patterns and statistics

## Supported Platforms

Currently supported and planned messaging platforms:

- ✅ **Azure Service Bus** - Fully supported
- 🚧 **RabbitMQ** - In development
- 🚧 **Apache Kafka** - In development
- 🚧 **AWS SQS/SNS** - Planned
- 🚧 **Google Pub/Sub** - Planned

## Technology Stack

- **Frontend**: Angular 21+ with Bootstrap 5
- **Desktop**: Electron 39+
- **Backend API**: .NET 10.0
- **UI Framework**: SmartAdmin Theme with Material Design components
- **Charts**: ApexCharts for data visualization

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- .NET 10.0 SDK
- Git

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/vitorafgomes/messaging-explorer.git
   cd messaging-explorer/web-app
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the .NET API**
   ```bash
   npm run build:api
   ```

### Development

#### Run in Development Mode

Start both the Angular dev server and the .NET API:

```bash
npm run electron:dev
```

This will:
- Start the .NET API on `http://localhost:5197`
- Start the Angular dev server on `http://localhost:4200`
- Launch the Electron app with hot-reload enabled

#### Run Individual Components

**Angular only:**
```bash
npm start
```

**API only:**
```bash
npm run start:api
```

**Both (without Electron):**
```bash
npm run start:all
```

### Building

#### Build for Production

**All platforms:**
```bash
npm run electron:build
```

**Specific platforms:**
```bash
npm run electron:build:win   # Windows (NSIS installer + portable)
npm run electron:build:mac   # macOS (DMG + ZIP)
npm run electron:build:linux # Linux (AppImage + DEB)
```

Build artifacts will be available in the `release/` directory.

### Testing

Run unit tests:
```bash
npm test
```

## Project Structure

```
web-app/
├── electron/           # Electron main process and preload scripts
│   ├── main.js        # Main Electron process
│   ├── preload.js     # Preload script for secure IPC
│   └── splash.html    # Splash screen
├── src/
│   ├── app/           # Angular application
│   │   ├── core/      # Core services and guards
│   │   ├── features/  # Feature modules
│   │   └── shared/    # Shared components and utilities
│   ├── assets/        # Static assets (icons, images, styles)
│   │   └── platforms/ # Platform-specific logos
│   └── index.html     # Main HTML file
├── public/            # Public static files
└── package.json       # NPM dependencies and scripts
```

## Configuration

### Connection Settings

Connections to messaging platforms are configured through the UI. Connection details are stored securely in the application's data directory.

### Environment Variables

- `NODE_ENV`: Set to `development` or `production`
- API endpoint is auto-configured based on environment

### Azure Monitor Integration

The application can display real-time metrics from Azure Monitor for Azure Service Bus queues, topics, and subscriptions. This integration provides accurate historical data for message counts, throughput, and request statistics.

#### Features

- 📊 **Real-time Metrics**: Display live message counts, throughput, and request statistics
- 🔄 **Auto-refresh**: Configurable automatic data refresh (30s, 1m, 5m intervals)
- 📈 **Historical Charts**: Visualize trends over time (1h, 6h, 12h, 24h, 7d)
- ⚡ **Intelligent Caching**: 30-second cache to reduce API calls and prevent throttling
- 🎯 **Graceful Fallback**: Application remains fully functional when metrics are unavailable

#### Required Azure Permissions

To access Azure Monitor metrics, the application needs the following Azure permissions:

1. **Monitoring Reader** role on the Azure Service Bus namespace
   - This role provides read-only access to monitoring data
   - Can be assigned at the namespace, resource group, or subscription level

2. **Azure Authentication**: One of the following methods:
   - **Managed Identity** (recommended for Azure-hosted deployments)
   - **Service Principal** with appropriate permissions
   - **Azure CLI** authentication (for local development)
   - **Visual Studio** or **Azure PowerShell** credentials
   - **Interactive browser** authentication

#### Configuration

Azure Monitor access can be configured using either `appsettings.json` or environment variables.

**Option 1: Configuration File** (`src/ServiceBusExplorer.Api/appsettings.json`):

```json
{
  "AzureMonitor": {
    "SubscriptionId": "your-azure-subscription-id",
    "ResourceGroup": "your-resource-group-name",
    "Namespace": "your-servicebus-namespace"
  }
}
```

**Option 2: Environment Variables**:

```bash
export AZURE_SUBSCRIPTION_ID="your-azure-subscription-id"
export AZURE_RESOURCE_GROUP="your-resource-group-name"
export AZURE_SERVICEBUS_NAMESPACE="your-servicebus-namespace"
```

**Finding Your Configuration Values**:

1. **Subscription ID**: Found in Azure Portal → Subscriptions
2. **Resource Group**: The resource group containing your Service Bus namespace
3. **Namespace**: Your Service Bus namespace name (not the full hostname)

#### Authentication Setup

The application uses Azure Identity SDK with `DefaultAzureCredential`, which automatically tries multiple authentication methods in order:

1. **Environment Variables**: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
2. **Managed Identity**: If running on Azure (App Service, VM, Container Instance, etc.)
3. **Visual Studio**: If signed into Visual Studio
4. **Azure CLI**: If signed in via `az login`
5. **Azure PowerShell**: If signed in via `Connect-AzAccount`
6. **Interactive Browser**: Falls back to interactive login

**For local development**, the easiest approach is Azure CLI:

```bash
az login
az account set --subscription "your-subscription-id"
```

**For production**, use Managed Identity:

```bash
# Enable system-assigned managed identity for your Azure resource
az webapp identity assign --name your-app-name --resource-group your-rg

# Grant Monitoring Reader permission
az role assignment create \
  --assignee <managed-identity-principal-id> \
  --role "Monitoring Reader" \
  --scope /subscriptions/{subscription-id}/resourceGroups/{rg}/providers/Microsoft.ServiceBus/namespaces/{namespace}
```

#### Metrics Data Sources

The application fetches the following metrics from Azure Monitor:

| Metric | Description | Chart |
|--------|-------------|-------|
| **Incoming Messages** | Number of messages sent to the queue/topic | Messages |
| **Outgoing Messages** | Number of messages delivered to receivers | Messages |
| **Active Messages** | Current count of messages in the queue/topic | Messages |
| **Successful Requests** | Number of successful API operations | Requests |
| **Server Errors** | Number of server-side errors (5xx) | Requests |
| **User Errors** | Number of client-side errors (4xx) | Requests |

All metrics are aggregated based on the selected time range:
- **1h, 6h, 12h**: 1-minute granularity
- **24h**: 5-minute granularity
- **7d**: 1-hour granularity

#### Refresh Intervals and Caching

**Backend Caching**:
- Metrics are cached for **30 seconds** on the server
- Prevents excessive Azure Monitor API calls
- Helps avoid Azure Monitor API throttling limits

**Frontend Auto-refresh**:
- **Default interval**: 60 seconds (configurable to 30s or 5m)
- **Smart pause**: Automatically pauses when browser tab is not visible
- **Manual refresh**: Available via refresh button at any time
- **Last refresh time**: Displayed in the UI for transparency

#### Troubleshooting

##### Metrics Not Showing / "Azure Monitor Not Configured" Message

**Symptoms**: The metrics tab shows a configuration message instead of charts.

**Solutions**:

1. **Verify Configuration Values**:
   ```bash
   # Check if values are set correctly
   echo $AZURE_SUBSCRIPTION_ID
   echo $AZURE_RESOURCE_GROUP
   echo $AZURE_SERVICEBUS_NAMESPACE
   ```

2. **Verify Azure Authentication**:
   ```bash
   # Test Azure CLI authentication
   az account show

   # List Service Bus namespaces to verify access
   az servicebus namespace list --resource-group your-rg
   ```

3. **Check Application Logs**: Look for errors in the API logs:
   ```
   "AzureMonitorMetricsService not configured"
   "Failed to initialize MetricsQueryClient"
   ```

##### "Unauthorized" or "Forbidden" Errors

**Symptoms**: Metrics fail to load with 401 or 403 errors.

**Solutions**:

1. **Verify Monitoring Reader role** is assigned:
   ```bash
   az role assignment list --assignee <your-identity> --scope /subscriptions/{sub-id}/resourceGroups/{rg}/providers/Microsoft.ServiceBus/namespaces/{namespace}
   ```

2. **Re-authenticate** if using Azure CLI:
   ```bash
   az logout
   az login
   ```

3. **Check token expiration**: Some authentication methods require periodic re-authentication.

##### Stale or Missing Data

**Symptoms**: Charts show old data or are empty.

**Solutions**:

1. **Check Azure Monitor Metrics Availability**:
   - Azure Monitor metrics have a ~3-5 minute delay
   - Verify metrics exist in Azure Portal → Service Bus → Metrics

2. **Clear Cache**: Restart the API to clear the in-memory cache

3. **Verify Time Range**: Metrics may not exist for very recent time ranges or if the entity had no activity

##### High API Costs

**Symptoms**: Azure Monitor API costs are higher than expected.

**Solutions**:

1. **Backend cache is working**: Verify 30-second cache is reducing duplicate requests
2. **Disable auto-refresh** if continuous monitoring isn't needed
3. **Increase refresh interval** from 30s to 5 minutes
4. **Use longer time ranges**: Reduces the number of data points fetched

##### Metrics Work Locally But Not in Production

**Symptoms**: Metrics display correctly on development machine but fail when deployed.

**Solutions**:

1. **Enable Managed Identity** on the Azure resource (App Service, Container, VM)
2. **Assign Monitoring Reader role** to the managed identity
3. **Set environment variables** in the Azure resource configuration
4. **Check network/firewall rules**: Ensure outbound access to Azure Monitor API

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Roadmap

- [ ] Complete RabbitMQ integration
- [ ] Complete Kafka integration
- [ ] Add AWS SQS/SNS support
- [ ] Add Google Pub/Sub support
- [ ] Message export/import functionality
- [ ] Advanced message replay capabilities
- [ ] Performance monitoring dashboard
- [ ] Plugin system for custom platforms

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

- 📧 Email: vitorafgomes@users.noreply.github.com
- 🐛 Issues: [GitHub Issues](https://github.com/vitorafgomes/messaging-explorer/issues)
- 📖 Documentation: [Wiki](https://github.com/vitorafgomes/messaging-explorer/wiki)

## Acknowledgments

- Built with [Angular](https://angular.io/)
- Desktop app powered by [Electron](https://www.electronjs.org/)
- Backend API built with [.NET](https://dotnet.microsoft.com/)
- UI components from [SmartAdmin](https://smartadmin.com/)
- Icons from [Font Awesome](https://fontawesome.com/)

---

**Made with ❤️ by the Messaging Explorer team**

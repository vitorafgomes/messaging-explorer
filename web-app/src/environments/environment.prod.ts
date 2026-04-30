// In Electron production builds the API port is set dynamically by the main
// process and read at runtime via window.electronAPI.getApiPort().
// This URL is only used as a fallback when running the production bundle
// outside Electron (e.g. served as a plain web app), and matches the default
// in config.json. It must NOT be a standard framework port (5000/5001/8080).
export const environment = {
  production: true,
  apiUrl: 'http://localhost:5917/api'
};

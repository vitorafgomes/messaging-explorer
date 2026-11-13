import { ChildProcess, execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, openSync, readFile, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, Server } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { RABBIT_USER, seedAzure, seedRabbit } from './seed';

const RABBITMQ_IMAGE = 'rabbitmq:4.3.7-management';
const EMULATOR_IMAGE = 'mcr.microsoft.com/azure-messaging/servicebus-emulator:2.0.1';
const SQL_IMAGE = 'mcr.microsoft.com/mssql/server:2022-CU14-ubuntu-22.04';
const HAPROXY_IMAGE = 'haproxy:3.0.30-alpine';
const START_TIMEOUT_MS = 5 * 60_000;

const webAppDir = resolve(__dirname, '..');
const apiProject = resolve(webAppDir, '../src/ServiceBusExplorer.Api');
const logDir = resolve(webAppDir, 'dist/e2e/logs');
const screenshotDir = resolve(webAppDir, 'dist/e2e/screenshots');
const appBuildDir = resolve(webAppDir, 'dist/e2e/app');
const appRoot = join(appBuildDir, 'browser');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject',
};

/** Serves the production build on loopback; the app routes by hash, so every page is index.html. */
function serveApp(port: number): Promise<Server> {
  const server = createHttpServer((request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname));
    const file = join(appRoot, path === '/' ? 'index.html' : path);
    if (!file.startsWith(appRoot)) {
      response.writeHead(403).end();
      return;
    }
    readFile(file, (error, data) => {
      if (error) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' }).end(data);
    });
  });
  return new Promise((done) => server.listen(port, '127.0.0.1', () => done(server)));
}

const HAPROXY_CFG = `defaults
    mode tcp
    timeout connect 5s
    timeout client 1h
    timeout server 1h

frontend servicebus
    bind :5673
    tcp-request inspect-delay 5s
    tcp-request content accept if { req.len ge 4 }
    acl is_amqp req.payload(0,4) -m bin 414d5150
    use_backend messaging if is_amqp
    default_backend management

backend messaging
    server emulator emulator:5672

backend management
    server emulator emulator:5300
`;

const EMULATOR_CONFIG = JSON.stringify({
  UserConfig: {
    Namespaces: [{ Name: 'sbemulatorns', Queues: [], Topics: [] }],
    Logging: { Type: 'File' },
  },
});

function docker(args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync('docker', args, { encoding: 'utf8', env: { ...process.env, ...env } }).trim();
}

function runWithFile(args: string[], image: string, file: string, target: string, env?: NodeJS.ProcessEnv): string {
  const id = docker(['create', ...args, image], env);
  docker(['cp', file, `${id}:${target}`]);
  docker(['start', id]);
  return id;
}

function mappedPort(container: string, port: number): number {
  const binding = docker(['port', container, `${port}/tcp`]).split('\n')[0];
  if (!binding.startsWith('127.0.0.1:')) {
    throw new Error(`Container port ${port} is not bound to loopback: ${binding}`);
  }
  return Number(binding.slice('127.0.0.1:'.length));
}

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });
}

async function waitFor(what: string, check: () => Promise<boolean>, timeoutMs = START_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const answers = (url: string, init?: RequestInit) => async () => (await fetch(url, init)).ok;

function startProcess(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, logFile: string): ChildProcess {
  const log = openSync(logFile, 'w');
  return spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', log, log] });
}

function stopProcess(child: ChildProcess): void {
  if (child.pid !== undefined && child.exitCode === null) {
    spawnSync('kill', ['-TERM', '--', `-${child.pid}`], { stdio: 'ignore' });
  }
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const runId = randomBytes(4).toString('hex');
  const label = `messaging-explorer-e2e=${runId}`;
  const network = `messaging-explorer-e2e-${runId}`;
  const workDir = mkdtempSync(join(tmpdir(), 'messaging-explorer-e2e-'));
  const processes: ChildProcess[] = [];
  let appServer: Server | undefined;
  mkdirSync(logDir, { recursive: true });
  rmSync(screenshotDir, { recursive: true, force: true });

  const teardown = async () => {
    processes.forEach(stopProcess);
    appServer?.close();
    const ids = docker(['ps', '-aq', '--filter', `label=${label}`]).split('\n').filter(Boolean);
    if (ids.length) docker(['rm', '-f', '-v', ...ids]);
    spawnSync('docker', ['network', 'rm', network], { stdio: 'ignore' });
    rmSync(workDir, { recursive: true, force: true });
  };

  try {
    const rabbitPassword = randomBytes(16).toString('hex');
    const sqlPassword = `E2e-${randomBytes(12).toString('hex')}-aA1`;
    const apiSecret = randomBytes(32).toString('hex');

    const rabbit = docker(
      ['run', '-d', '--label', label, '-e', `RABBITMQ_DEFAULT_USER=${RABBIT_USER}`, '-e', 'RABBITMQ_DEFAULT_PASS',
        '-p', '127.0.0.1::5672', '-p', '127.0.0.1::15672', RABBITMQ_IMAGE],
      { RABBITMQ_DEFAULT_PASS: rabbitPassword });

    writeFileSync(join(workDir, 'haproxy.cfg'), HAPROXY_CFG);
    writeFileSync(join(workDir, 'Config.json'), EMULATOR_CONFIG);
    docker(['network', 'create', '--label', label, network]);
    docker(['run', '-d', '--label', label, '--network', network, '--network-alias', 'sql',
      '-e', 'ACCEPT_EULA=Y', '-e', 'MSSQL_SA_PASSWORD', SQL_IMAGE], { MSSQL_SA_PASSWORD: sqlPassword });
    const emulator = runWithFile(['--label', label, '--network', network, '--network-alias', 'emulator',
      '-e', 'ACCEPT_EULA=Y', '-e', 'SQL_SERVER=sql', '-e', 'MSSQL_SA_PASSWORD', '-e', 'SQL_WAIT_INTERVAL=15'],
      EMULATOR_IMAGE, join(workDir, 'Config.json'), '/ServiceBus_Emulator/ConfigFiles/Config.json',
      { MSSQL_SA_PASSWORD: sqlPassword });
    const proxy = runWithFile(['--label', label, '--network', network, '-p', '127.0.0.1::5673'],
      HAPROXY_IMAGE, join(workDir, 'haproxy.cfg'), '/usr/local/etc/haproxy/haproxy.cfg');

    const apiPort = await freePort();
    const frontendPort = await freePort();
    const dataPath = join(workDir, 'data');
    const configPath = join(workDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({ apiPort, frontendPort }));

    const apiEnv: NodeJS.ProcessEnv = {
      ...process.env,
      API_SECRET: apiSecret,
      SERVICEBUS_DATA_PATH: dataPath,
      EXPLORER_CONFIG_PATH: configPath,
    };
    delete apiEnv.ASPNETCORE_URLS;
    processes.push(startProcess('dotnet', ['run', '--no-launch-profile', '--project', apiProject],
      webAppDir, apiEnv, join(logDir, 'api.log')));
    const buildLog = openSync(join(logDir, 'ng-build.log'), 'w');
    execFileSync('npx', ['ng', 'build', '--output-path', appBuildDir], { cwd: webAppDir, stdio: ['ignore', buildLog, buildLog] });
    appServer = await serveApp(frontendPort);

    const rabbitAmqpPort = mappedPort(rabbit, 5672);
    const rabbitManagementPort = mappedPort(rabbit, 15672);
    const proxyPort = mappedPort(proxy, 5673);
    const apiUrl = `http://localhost:${apiPort}`;

    await waitFor('the API', answers(`${apiUrl}/health`));
    await waitFor('RabbitMQ', answers(`http://127.0.0.1:${rabbitManagementPort}/api/overview`, {
      headers: { Authorization: `Basic ${Buffer.from(`${RABBIT_USER}:${rabbitPassword}`).toString('base64')}` },
    }));
    await waitFor('the Service Bus emulator', async () =>
      docker(['logs', emulator]).includes('Emulator Service is Successfully Up!'));

    const rabbitConnection = {
      name: 'orders-rabbitmq',
      providerType: 'RabbitMQ',
      hostName: 'localhost',
      port: rabbitAmqpPort,
      userName: RABBIT_USER,
      password: rabbitPassword,
      virtualHost: '/',
      managementPort: rabbitManagementPort,
    };
    const azureConnectionString =
      `Endpoint=sb://localhost:${proxyPort};SharedAccessKeyName=RootManageSharedAccessKey;` +
      'SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;';

    const seedApi = { url: `${apiUrl}/api`, secret: apiSecret };
    await seedRabbit(seedApi, rabbitConnection);
    await seedAzure(seedApi, azureConnectionString);

    Object.assign(process.env, {
      E2E_API_PORT: String(apiPort),
      E2E_API_SECRET: apiSecret,
      E2E_BASE_URL: `http://localhost:${frontendPort}`,
      E2E_RABBIT_AMQP_PORT: String(rabbitAmqpPort),
      E2E_RABBIT_MANAGEMENT_PORT: String(rabbitManagementPort),
      E2E_RABBIT_PASSWORD: rabbitPassword,
      E2E_AZURE_CONNECTION_STRING: azureConnectionString,
    });
  } catch (error) {
    await teardown();
    throw error;
  }

  return teardown;
}

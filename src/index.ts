import { loadEnv } from './config/env';
import { startServer } from './server';

const env = loadEnv();
startServer(env);

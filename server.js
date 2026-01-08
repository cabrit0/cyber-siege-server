/**
 * Cyber Siege - Servidor Backend
 * 
 * Ponto de entrada do servidor que:
 * - Inicializa Express e Socket.IO
 * - Configura CORS para aceitar conexões do frontend
 * - Conecta à base de dados MongoDB (opcional)
 * - Regista os handlers de jogo
 */

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const connectDB = require('./config/db');
const gameHandler = require('./socket/gameHandler');

// Configurações
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Inicializar Express
const app = express();

// Middleware
app.use(cors({
    origin: [
        FRONTEND_URL,
        'http://localhost:5173',
        'http://localhost:3000',
        // Permitir qualquer IP local para testes em rede
        /^http:\/\/192\.168\.\d+\.\d+:\d+$/,
        /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/
    ],
    methods: ['GET', 'POST'],
    credentials: true
}));

app.use(express.json());

// Rota de health check
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        name: 'Cyber Siege Server',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

// Criar servidor HTTP
const server = http.createServer(app);

// Inicializar Socket.IO
const io = new Server(server, {
    cors: {
        origin: [
            FRONTEND_URL,
            'http://localhost:5173',
            'http://localhost:3000',
            // Permitir qualquer IP local para testes em rede
            /^http:\/\/192\.168\.\d+\.\d+:\d+$/,
            /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/
        ],
        methods: ['GET', 'POST'],
        credentials: true
    },
    // Configurações de performance
    pingTimeout: 60000,
    pingInterval: 25000
});

// Registar handlers de jogo
gameHandler(io);

// Iniciar servidor
const startServer = async () => {
    // Tentar conectar à base de dados (opcional)
    await connectDB();

    server.listen(PORT, '0.0.0.0', () => {
        console.log('');
        console.log('╔════════════════════════════════════════════╗');
        console.log('║       🎮 CYBER SIEGE SERVER 🎮              ║');
        console.log('╠════════════════════════════════════════════╣');
        console.log(`║  🌐 HTTP: http://localhost:${PORT}            ║`);
        console.log(`║  🔌 Socket.IO: ws://localhost:${PORT}         ║`);
        console.log('╠════════════════════════════════════════════╣');
        console.log('║  📱 Para acesso em rede, usa o IP local:   ║');
        console.log('║     Execute: ipconfig (Windows)            ║');
        console.log('║     Execute: ifconfig (Mac/Linux)          ║');
        console.log('╚════════════════════════════════════════════╝');
        console.log('');
    });
};

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
    console.error('❌ Erro não capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promise rejeitada:', reason);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('📴 Recebido SIGTERM, a encerrar...');
    server.close(() => {
        console.log('👋 Servidor encerrado');
        process.exit(0);
    });
});

// Iniciar
startServer();

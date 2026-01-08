/**
 * Modelo de Dados do Jogo - MongoDB Schema
 * 
 * Define a estrutura de uma sessão de jogo guardada na base de dados.
 * Inclui informações sobre jogadores, estado, pontuações e histórico de rondas.
 */

const mongoose = require('mongoose');

// Schema para cada ronda jogada
const RoundSchema = new mongoose.Schema({
    round: { type: Number, required: true },
    themeId: { type: String },
    themeName: { type: String },
    attackerTool: { type: String },
    defenderTool: { type: String },
    isCorrect: { type: Boolean },
    responseTime: { type: Number }, // em segundos
    scoreGained: { type: Number, default: 0 },
    winner: { type: String, enum: ['attacker', 'defender'] },
    timedOut: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now }
});

// Schema principal do jogo
const GameSchema = new mongoose.Schema({
    // Identificador único da sessão
    sessionId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },

    // Estado atual do jogo
    status: {
        type: String,
        enum: ['LOBBY', 'READY', 'ATTACKING', 'DEFENDED', 'BREACHED'],
        default: 'LOBBY'
    },

    // Tema ativo
    activeThemeId: { type: String },
    activeTheme: { type: mongoose.Schema.Types.Mixed },

    // Jogadores (Socket IDs)
    attacker: {
        socketId: { type: String },
        connected: { type: Boolean, default: false }
    },
    defender: {
        socketId: { type: String },
        connected: { type: Boolean, default: false }
    },

    // Estado da ronda atual
    currentRound: {
        attackerTool: { type: String },
        defenderTool: { type: String },
        startTime: { type: Date },
        endTime: { type: Date }
    },

    // Pontuações
    attackerScore: { type: Number, default: 0 },
    defenderScore: { type: Number, default: 0 },
    roundNumber: { type: Number, default: 0 },
    totalRounds: { type: Number, default: 0 },
    streak: { type: Number, default: 0 },

    // Histórico de rondas
    history: [RoundSchema],

    // Timestamps automáticos
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Atualizar updatedAt antes de guardar
GameSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

// Índice para limpeza de jogos antigos
GameSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 3600 }); // Expira após 1 hora

module.exports = mongoose.model('Game', GameSchema);

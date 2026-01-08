/**
 * Game Handler - Lógica de Jogo via Socket.IO
 * 
 * Gere todos os eventos de jogo entre atacante e defensor:
 * - Criação/entrada em salas
 * - Execução de ataques
 * - Tentativas de defesa
 * - Sincronização de estado
 */

// Armazenamento em memória (fallback se MongoDB não disponível)
const games = new Map();

// Estados possíveis do jogo
const GameStatus = {
    LOBBY: 'LOBBY',
    READY: 'READY',
    ATTACKING: 'ATTACKING',
    DEFENDED: 'DEFENDED',
    BREACHED: 'BREACHED'
};

/**
 * Cria um estado inicial limpo para um novo jogo
 */
const createInitialState = (sessionId) => ({
    sessionId,
    status: GameStatus.LOBBY,
    activeThemeId: null,
    activeTheme: null,
    attacker: { socketId: null, connected: false },
    defender: { socketId: null, connected: false },
    currentRound: {
        attackerTool: null,
        defenderTool: null,
        startTime: null,
        endTime: null
    },
    attackerScore: 0,
    defenderScore: 0,
    roundNumber: 0,
    totalRounds: 0,
    streak: 0,
    history: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
});

/**
 * Obtém ou cria um jogo
 */
const getOrCreateGame = (sessionId) => {
    if (!games.has(sessionId)) {
        games.set(sessionId, createInitialState(sessionId));
    }
    return games.get(sessionId);
};

/**
 * Converte estado interno para formato do cliente
 */
const toClientState = (game) => ({
    sessionId: game.sessionId,
    gameStatus: game.status,
    activeThemeId: game.activeThemeId,
    activeTheme: game.activeTheme,
    attackerTool: game.currentRound.attackerTool,
    defenderTool: game.currentRound.defenderTool,
    startTime: game.currentRound.startTime,
    endTime: game.currentRound.endTime,
    attackerScore: game.attackerScore,
    defenderScore: game.defenderScore,
    roundNumber: game.roundNumber,
    totalRounds: game.totalRounds,
    streak: game.streak,
    responseTime: game.currentRound.endTime && game.currentRound.startTime
        ? (game.currentRound.endTime - game.currentRound.startTime) / 1000
        : null,
    history: game.history,
    players: {
        attacker: game.attacker.connected,
        defender: game.defender.connected
    }
});

/**
 * Calcula pontuação com base no tempo e streak
 */
const calculateScore = (timeRemaining, maxTime, correct, streak) => {
    if (!correct) return 0;
    const base = 100;
    const timeBonus = Math.round((timeRemaining / maxTime) * 200);
    const streakBonus = streak * 50;
    return base + timeBonus + streakBonus;
};

/**
 * Configura os handlers de Socket.IO
 */
module.exports = (io) => {
    io.on('connection', (socket) => {
        console.log(`🔌 Cliente conectado: ${socket.id}`);

        let currentSessionId = null;
        let currentRole = null;

        /**
         * JOIN_GAME - Jogador entra numa sessão
         * @param {Object} data - { sessionId, role: 'attacker'|'defender', theme }
         */
        socket.on('join_game', (data) => {
            const { sessionId, role, theme } = data;

            if (!sessionId || !role) {
                socket.emit('error', { message: 'sessionId e role são obrigatórios' });
                return;
            }

            // Sair da sala anterior se existir
            if (currentSessionId) {
                socket.leave(currentSessionId);
            }

            // Obter ou criar jogo
            const game = getOrCreateGame(sessionId);

            // Atribuir jogador ao papel
            if (role === 'attacker') {
                game.attacker = { socketId: socket.id, connected: true };
            } else if (role === 'defender') {
                game.defender = { socketId: socket.id, connected: true };
            }

            // Guardar referências
            currentSessionId = sessionId;
            currentRole = role;

            // Entrar na sala Socket.IO
            socket.join(sessionId);

            // Se tema fornecido, atualizar
            if (theme) {
                game.activeThemeId = theme.id;
                game.activeTheme = theme;
            }

            // Limpar estado da ronda se o jogo não estiver em ATTACKING
            // Isto previne que o defensor veja um ataque antigo ao entrar
            if (game.status !== GameStatus.ATTACKING) {
                game.currentRound = {
                    attackerTool: null,
                    defenderTool: null,
                    startTime: null,
                    endTime: null
                };
            }

            // Se ambos os jogadores conectados, mudar para READY
            if (game.attacker.connected && game.defender.connected && game.status === GameStatus.LOBBY) {
                game.status = GameStatus.READY;
            }

            game.updatedAt = Date.now();

            console.log(`👤 ${role} entrou na sessão ${sessionId}`);

            // Notificar todos na sala
            io.to(sessionId).emit('game_state', toClientState(game));
            io.to(sessionId).emit('player_joined', { role, socketId: socket.id });
        });

        /**
         * START_GAME - Iniciar jogo com tema
         * @param {Object} data - { theme }
         */
        socket.on('start_game', (data) => {
            if (!currentSessionId) {
                socket.emit('error', { message: 'Não está numa sessão' });
                return;
            }

            const game = games.get(currentSessionId);
            if (!game) return;

            const { theme } = data;

            game.activeThemeId = theme.id;
            game.activeTheme = theme;
            game.status = GameStatus.READY;
            game.roundNumber = 0;
            game.currentRound = {
                attackerTool: null,
                defenderTool: null,
                startTime: null,
                endTime: null
            };
            game.updatedAt = Date.now();

            console.log(`🎮 Jogo iniciado na sessão ${currentSessionId} com tema: ${theme.titulo}`);

            io.to(currentSessionId).emit('game_state', toClientState(game));
            io.to(currentSessionId).emit('game_started', { theme });
        });

        /**
         * EXECUTE_ATTACK - Atacante executa ataque
         * @param {Object} data - { toolId }
         */
        socket.on('execute_attack', (data) => {
            if (!currentSessionId || currentRole !== 'attacker') {
                socket.emit('error', { message: 'Apenas o atacante pode atacar' });
                return;
            }

            const game = games.get(currentSessionId);
            if (!game) return;

            const { toolId } = data;

            game.currentRound.attackerTool = toolId;
            game.currentRound.defenderTool = null;
            game.currentRound.startTime = Date.now();
            game.currentRound.endTime = null;
            game.status = GameStatus.ATTACKING;
            game.roundNumber += 1;
            game.updatedAt = Date.now();

            console.log(`⚔️  Ataque executado: ${toolId} (Ronda ${game.roundNumber})`);

            io.to(currentSessionId).emit('game_state', toClientState(game));
            io.to(currentSessionId).emit('attack_executed', {
                toolId,
                roundNumber: game.roundNumber,
                startTime: game.currentRound.startTime
            });
        });

        /**
         * EXECUTE_DEFENSE - Defensor executa defesa
         * @param {Object} data - { toolId, isCorrect, timeRemaining }
         */
        socket.on('execute_defense', (data) => {
            if (!currentSessionId || currentRole !== 'defender') {
                socket.emit('error', { message: 'Apenas o defensor pode defender' });
                return;
            }

            const game = games.get(currentSessionId);
            if (!game || game.status !== GameStatus.ATTACKING) return;

            const { toolId, isCorrect, timeRemaining = 0 } = data;
            const maxTime = game.activeTheme?.tempo || 30;
            const score = calculateScore(timeRemaining, maxTime, isCorrect, game.streak);

            game.currentRound.defenderTool = toolId;
            game.currentRound.endTime = Date.now();

            const roundResult = {
                round: game.roundNumber,
                themeId: game.activeThemeId,
                themeName: game.activeTheme?.titulo,
                attackerTool: game.currentRound.attackerTool,
                defenderTool: toolId,
                isCorrect,
                responseTime: (game.currentRound.endTime - game.currentRound.startTime) / 1000,
                scoreGained: score,
                winner: isCorrect ? 'defender' : 'attacker',
                timedOut: false,
                timestamp: Date.now()
            };

            game.history.push(roundResult);
            game.status = isCorrect ? GameStatus.DEFENDED : GameStatus.BREACHED;
            game.defenderScore += score;
            game.attackerScore += isCorrect ? 0 : 150;
            game.streak = isCorrect ? game.streak + 1 : 0;
            game.totalRounds += 1;
            game.updatedAt = Date.now();

            console.log(`🛡️  Defesa: ${toolId} - ${isCorrect ? 'SUCESSO' : 'FALHOU'}`);

            io.to(currentSessionId).emit('game_state', toClientState(game));
            io.to(currentSessionId).emit('round_result', roundResult);
        });

        /**
         * TIME_EXPIRED - Tempo esgotado
         */
        socket.on('time_expired', () => {
            if (!currentSessionId) return;

            const game = games.get(currentSessionId);
            if (!game || game.status !== GameStatus.ATTACKING) return;

            game.currentRound.endTime = Date.now();

            const roundResult = {
                round: game.roundNumber,
                themeId: game.activeThemeId,
                themeName: game.activeTheme?.titulo,
                attackerTool: game.currentRound.attackerTool,
                defenderTool: null,
                isCorrect: false,
                responseTime: game.activeTheme?.tempo || 0,
                scoreGained: 0,
                winner: 'attacker',
                timedOut: true,
                timestamp: Date.now()
            };

            game.history.push(roundResult);
            game.status = GameStatus.BREACHED;
            game.attackerScore += 200;
            game.streak = 0;
            game.totalRounds += 1;
            game.updatedAt = Date.now();

            console.log(`⏱️  Tempo esgotado na ronda ${game.roundNumber}`);

            io.to(currentSessionId).emit('game_state', toClientState(game));
            io.to(currentSessionId).emit('round_result', roundResult);
        });

        /**
         * NEXT_ROUND - Nova ronda
         */
        socket.on('next_round', () => {
            if (!currentSessionId) return;

            const game = games.get(currentSessionId);
            if (!game) return;

            game.status = GameStatus.READY;
            game.currentRound = {
                attackerTool: null,
                defenderTool: null,
                startTime: null,
                endTime: null
            };
            game.updatedAt = Date.now();

            console.log(`🔄 Nova ronda preparada na sessão ${currentSessionId}`);

            io.to(currentSessionId).emit('game_state', toClientState(game));
            io.to(currentSessionId).emit('next_round_ready');
        });

        /**
         * RESET_GAME - Reiniciar jogo completamente
         */
        socket.on('reset_game', () => {
            if (!currentSessionId) return;

            const freshState = createInitialState(currentSessionId);
            games.set(currentSessionId, freshState);

            console.log(`🔃 Jogo reiniciado na sessão ${currentSessionId}`);

            io.to(currentSessionId).emit('game_state', toClientState(freshState));
            io.to(currentSessionId).emit('game_reset');
        });

        /**
         * REPLAY_GAME - Jogar novamente mantendo pontuações
         */
        socket.on('replay_game', () => {
            if (!currentSessionId) return;

            const game = games.get(currentSessionId);
            if (!game) return;

            // Reset da ronda mas manter scores e histórico
            game.status = GameStatus.READY;
            game.currentRound = {
                attackerTool: null,
                defenderTool: null,
                startTime: null,
                endTime: null
            };
            game.roundNumber = 0;
            game.streak = 0;
            // NÃO resetar: attackerScore, defenderScore, totalRounds, history
            game.updatedAt = Date.now();

            console.log(`🔄 Replay na sessão ${currentSessionId} (scores: ATK=${game.attackerScore} DEF=${game.defenderScore})`);

            io.to(currentSessionId).emit('game_state', toClientState(game));
            io.to(currentSessionId).emit('game_replay');
        });

        /**
         * REQUEST_STATE - Solicitar estado atual
         */
        socket.on('request_state', () => {
            if (!currentSessionId) return;

            const game = games.get(currentSessionId);
            if (game) {
                socket.emit('game_state', toClientState(game));
            }
        });

        /**
         * DISCONNECT - Jogador desconectou
         */
        socket.on('disconnect', () => {
            console.log(`🔌 Cliente desconectado: ${socket.id}`);

            if (currentSessionId) {
                const game = games.get(currentSessionId);
                if (game) {
                    // Marcar jogador como desconectado
                    if (game.attacker.socketId === socket.id) {
                        game.attacker.connected = false;
                    }
                    if (game.defender.socketId === socket.id) {
                        game.defender.connected = false;
                    }
                    game.updatedAt = Date.now();

                    // Notificar outros jogadores
                    io.to(currentSessionId).emit('player_disconnected', {
                        role: currentRole,
                        socketId: socket.id
                    });
                    io.to(currentSessionId).emit('game_state', toClientState(game));

                    // Se ambos desconectados, limpar após 5 minutos
                    if (!game.attacker.connected && !game.defender.connected) {
                        setTimeout(() => {
                            const g = games.get(currentSessionId);
                            if (g && !g.attacker.connected && !g.defender.connected) {
                                games.delete(currentSessionId);
                                console.log(`🗑️  Sessão ${currentSessionId} removida por inatividade`);
                            }
                        }, 5 * 60 * 1000);
                    }
                }
            }
        });
    });

    // Limpeza periódica de jogos antigos (cada 10 minutos)
    setInterval(() => {
        const now = Date.now();
        const maxAge = 60 * 60 * 1000; // 1 hora

        for (const [sessionId, game] of games.entries()) {
            if (now - game.updatedAt > maxAge) {
                games.delete(sessionId);
                console.log(`🗑️  Sessão ${sessionId} expirada e removida`);
            }
        }
    }, 10 * 60 * 1000);

    console.log('🎮 Game Handler inicializado');
};

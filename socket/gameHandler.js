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
    BREACHED: 'BREACHED',
    THEME_COMPLETED: 'THEME_COMPLETED', // Novo estado: Fim das 3 rondas do tema
    GAME_FINISHED: 'GAME_FINISHED' // Novo estado: Todos os temas jogados
};

/**
 * Cria um estado inicial limpo para um novo jogo
 */
const createInitialState = (sessionId) => ({
    sessionId,
    status: GameStatus.LOBBY,
    activeThemeId: null,
    activeTheme: null,
    attacker: { socketId: null, userId: null, connected: false },
    defender: { socketId: null, userId: null, connected: false },
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
    playedThemes: [], // Array de IDs de temas já jogados
    themeRoundCount: 0, // Contador de rondas do tema atual (1-3)
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
        attacker: { id: game.attacker.socketId, connected: game.attacker.connected },
        defender: { id: game.defender.socketId, connected: game.defender.connected }
    },
    playedThemes: game.playedThemes,
    themeRoundCount: game.themeRoundCount
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
        let currentRole = null; // Apenas referência local inicial, o state dita a verdade

        /**
         * JOIN_GAME - Jogador entra numa sessão
         * @param {Object} data - { sessionId, role: 'attacker'|'defender', theme }
         */
        socket.on('join_game', async (data) => { // Async handler
            console.log('📥 Request join_game:', data);
            const { sessionId, role: requestedRole, theme, userId } = data; // Receber userId
            let finalRole = requestedRole;

            if (!sessionId) {
                socket.emit('error', { message: 'ID da sessão é obrigatório' });
                return;
            }

            // Sair da sala anterior se existir
            if (currentSessionId) {
                socket.leave(currentSessionId);
            }

            // Obter ou criar jogo
            const game = getOrCreateGame(sessionId);
            console.log(`🔍 Estado atual da sala ${sessionId}:`, {
                attacker: game.attacker?.socketId,
                defender: game.defender?.socketId
            });

            // Atribuir jogador ao papel
            // Auto-assign se role não for fornecido (Guest Mode)
            if (!finalRole) {
                if (game.attacker.connected && !game.defender.connected) {
                    finalRole = 'defender';
                } else if (!game.attacker.connected && game.defender.connected) {
                    finalRole = 'attacker';
                } else if (!game.attacker.connected && !game.defender.connected) {
                    // Sala vazia - Guest first?
                    socket.emit('error', { message: 'A aguardar pelo anfitrião...' });
                    return;
                } else {
                    // Sala cheia
                    // Mas pode ser reconexão (verificar userId)
                    if (userId && game.attacker.userId === userId) finalRole = 'attacker';
                    else if (userId && game.defender.userId === userId) finalRole = 'defender';
                    else {
                        console.warn(`⛔ Sala cheia para ${socket.id}`);
                        socket.emit('error', { message: 'Sala cheia' });
                        return;
                    }
                }
            }

            // Atribuir jogador ao papel com suporte a reconexão por userId
            if (finalRole === 'attacker') {
                game.attacker = { socketId: socket.id, userId: userId || null, connected: true };
            } else if (finalRole === 'defender') {
                game.defender = { socketId: socket.id, userId: userId || null, connected: true };
            }

            // Guardar referências
            currentSessionId = sessionId;
            currentRole = finalRole;

            // Entrar na sala Socket.IO (AWAIT IMPORTANTE)
            await socket.join(sessionId);
            console.log(`✅ Socket ${socket.id} entrou na sala ${sessionId}`);

            // Herdar tema se não fornecido e já existir
            if (!data.theme && game.activeTheme) {
                // Guest herda tema
            }

            // Se tema fornecido (Host joining or setting up), atualizar
            if (data.theme) {
                // BUG FIX: Normalizar IDs para garantir comparação correta
                const incomingThemeId = String(data.theme.id);
                const currentThemeId = String(game.activeThemeId);

                // Só resetar contadores se o tema mudar de verdade
                if (currentThemeId !== incomingThemeId) {
                    console.log(`🆕 [RESET] Novo tema detetado: ${incomingThemeId} (Anterior: ${currentThemeId}). Resetando themeRoundCount de ${game.themeRoundCount} para 1.`);
                    game.activeTheme = data.theme;
                    game.activeThemeId = data.theme.id;
                    game.themeRoundCount = 1;

                    if (!game.playedThemes.includes(data.theme.id)) {
                        game.playedThemes.push(data.theme.id);
                    }
                } else {
                    console.log(`ℹ️ [KEEP] Tema mantido na reconexão: ${incomingThemeId} (ID igual). Mantendo themeRoundCount em ${game.themeRoundCount}.`);
                }
            } else {
                console.log(`ℹ️ [NO-THEME] join_game sem tema. Mantendo estado atual: ${game.activeThemeId} / Round ${game.themeRoundCount}`);
            }

            // Limpar estado da ronda se o jogo não estiver em ATTACKING
            if (game.status !== GameStatus.ATTACKING) {
                game.currentRound = {
                    attackerTool: null,
                    defenderTool: null,
                    startTime: null,
                    endTime: null
                };
            }

            // Se ambos os jogadores conectados, mudar para READY
            if (game.attacker.connected && game.defender.connected) {
                game.status = GameStatus.READY;
            } else {
                game.status = GameStatus.LOBBY;
            }

            game.updatedAt = Date.now();

            console.log(`👤 ${finalRole} entrou na sessão ${sessionId}. Status: ${game.status}`);

            // Notificar todos na sala
            io.to(sessionId).emit('game_state', toClientState(game));
            io.to(sessionId).emit('player_joined', { role: finalRole, socketId: socket.id });
        });

        /**
         * START_GAME - Iniciar jogo com tema e papel
         * @param {Object} data - { theme, role, sessionId }
         */
        socket.on('start_game', (data) => {
            const { theme, role, sessionId, userId } = data;

            // Usar sessionId fornecido ou o atual da socket
            const targetSessionId = sessionId || currentSessionId;

            if (!targetSessionId) {
                socket.emit('error', { message: 'Não está numa sessão' });
                return;
            }

            // Atualizar contexto da socket se necessário
            if (sessionId && sessionId !== currentSessionId) {
                socket.join(sessionId);
                currentSessionId = sessionId;
                console.log(`🔌 Socket associado à sessão ${sessionId} via start_game`);
            }

            let game = games.get(targetSessionId);

            // Se o jogo não existe, criar (Start New Game logic)
            if (!game) {
                console.log(`🆕 Criando nova sessão de jogo ${targetSessionId} via start_game`);
                // Criar estado inicial
                game = createInitialState(targetSessionId);

                // Definir papel inicial
                if (role === 'attacker') {
                    game.attacker = { socketId: socket.id, connected: true };
                } else if (role === 'defender') {
                    game.defender = { socketId: socket.id, connected: true };
                    game.defender = { socketId: socket.id, userId: userId, connected: true };
                }

                games.set(targetSessionId, game);
            }

            // Se role for fornecido e jogo já existia, gerir papéis com segurança e persistência
            if (role) {
                const myId = socket.id;

                // Tentar identificar o "outro" pelo userId se possível, ou pelo socket anterior
                // Se eu (UserId) sou o Vencedor, quem é o outro?

                // Lógica simplificada robusta:
                // Eu sou 'myId' e 'userId'. Eu quero ser 'role'.
                // O outro deve ser o socket/user que estava no outro papel.

                // Snapshot atual
                const oldAttacker = { ...game.attacker };
                const oldDefender = { ...game.defender };

                // Quem sou eu no estado atual?
                // Se eu era attacker, o outro era defender.
                let otherPlayer = null;
                if (oldAttacker.socketId === myId || (userId && oldAttacker.userId === userId)) {
                    otherPlayer = oldDefender;
                } else if (oldDefender.socketId === myId || (userId && oldDefender.userId === userId)) {
                    otherPlayer = oldAttacker;
                } else {
                    // Novo jogador ou não identificado?
                    // Assumir que o Slot Vazio ou o Slot Oposto é o outro.
                    otherPlayer = role === 'attacker' ? oldDefender : oldAttacker;
                }

                if (role === 'attacker') {
                    game.attacker = { socketId: myId, userId: userId, connected: true };
                    // Preservar o outro se tiver dados
                    if (otherPlayer && (otherPlayer.socketId || otherPlayer.userId)) {
                        game.defender = otherPlayer;
                    } else {
                        game.defender = { socketId: null, userId: null, connected: false };
                    }
                } else { // role === 'defender'
                    game.defender = { socketId: myId, userId: userId, connected: true };
                    if (otherPlayer && (otherPlayer.socketId || otherPlayer.userId)) {
                        game.attacker = otherPlayer;
                    } else {
                        game.attacker = { socketId: null, userId: null, connected: false };
                    }
                }
                currentRole = role;
                console.log(`🎭 Papéis definidos (com userId): Eu(${role})=${userId?.substring(0, 4)}... Outro=${otherPlayer?.userId?.substring(0, 4)}...`);
            }

            game.activeThemeId = theme.id;
            game.activeTheme = theme;

            // Só iniciar (READY) se ambos estiverem presentes. Caso contrário LOBBY.
            if (game.attacker.connected && game.defender.connected) {
                game.status = GameStatus.READY;
            } else {
                game.status = GameStatus.LOBBY;
                console.log(`⏳ Sessão ${currentSessionId} em LOBBY à espera de oponente`);
            }

            game.roundNumber = 0;
            game.themeRoundCount = 1; // Reset theme round count
            // FIX: Não adicionar aos playedThemes aqui! Apenas quando completar (handleNextRound)
            // if (!game.playedThemes.includes(theme.id)) {
            //    game.playedThemes.push(theme.id); 
            // }
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
            const game = games.get(currentSessionId);
            if (!game || !currentSessionId) return;

            // Validação de Role pelo Socket ID (mais seguro que a var local)
            const isAttacker = game.attacker.socketId === socket.id;
            if (!isAttacker) {
                socket.emit('error', { message: 'Apenas o atacante pode atacar' });
                return;
            }

            // BUG FIX: Impedir ataques se o tema já acabou (evita Round 4+)
            if (game.status === GameStatus.THEME_COMPLETED) {
                socket.emit('error', { message: 'O tema foi concluído. Aguarde a seleção do próximo tema.' });
                return;
            }

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
            const game = games.get(currentSessionId);
            if (!game || !currentSessionId || game.status !== GameStatus.ATTACKING) return;

            // Validação
            const isDefender = game.defender.socketId === socket.id;
            if (!isDefender) {
                socket.emit('error', { message: 'Apenas o defensor pode defender' });
                return;
            }

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
                timestamp: Date.now(),
                timestamp: Date.now(),
                winnerSocketId: isCorrect ? game.defender.socketId : game.attacker.socketId,
                winnerUserId: isCorrect ? game.defender.userId : game.attacker.userId
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
                timestamp: Date.now(),
                timestamp: Date.now(),
                winnerSocketId: game.attacker.socketId,
                winnerUserId: game.attacker.userId
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
         * CHOOSE_NEXT_ROLE - Vencedor escolhe próximo papel
         * @param {Object} data - { role: 'attacker' | 'defender' }
         */
        socket.on('choose_next_role', (data) => {
            if (!currentSessionId) return;
            const game = games.get(currentSessionId);
            if (!game) return;

            // Verificar se quem chamou foi o vencedor da última ronda
            const lastRound = game.history[game.history.length - 1];
            if (!lastRound) return; // Não há histórico?

            // Validação robusta baseada no papel vencedor e reconexão
            const winnerRoleLastRound = lastRound.winner; // 'attacker' ou 'defender'
            let callerRole = null;
            if (game.attacker.socketId === socket.id) callerRole = 'attacker';
            else if (game.defender.socketId === socket.id) callerRole = 'defender';

            // Se eu sou o socket atual do papel que venceu, então sou o vencedor
            if (callerRole !== winnerRoleLastRound) {
                socket.emit('error', { message: 'Apenas o vencedor da ronda anterior pode escolher o papel' });
                return;
            }

            const winnerRole = data.role;
            const loserRole = winnerRole === 'attacker' ? 'defender' : 'attacker';

            const winnerSocketId = socket.id;
            const loserSocketId = game.attacker.socketId === socket.id ? game.defender.socketId : game.attacker.socketId;

            // BUG FIX POTENCIAL: Se o perdedor tiver saído?
            // Assumimos que estão ambos conectados.

            // Atualizar os objetos attacker e defender no gameState
            // Criar cópias para não confundir referências
            const socketIds = { [winnerRole]: winnerSocketId, [loserRole]: loserSocketId };
            const connections = { [winnerRole]: true, [loserRole]: true }; // Assumindo conectados

            // Reconstruir player configs
            game.attacker = { socketId: socketIds.attacker, connected: true };
            game.defender = { socketId: socketIds.defender, connected: true };

            console.log(`🔀 Troca de Papéis na sessão ${currentSessionId}: Vencedor escolheu ${winnerRole}`);

            // Avançar para Next Round logic
            handleNextRound(game, currentSessionId);
        });

        /**
         * Lógica interna para avançar ronda
         */
        const handleNextRound = (game, sessionId) => {
            // Garantir que é número (FIX: evita loop infinito por string '11')
            game.themeRoundCount = Number(game.themeRoundCount) || 1;

            // Verificar se atingimos o limite de 3 rondas por tema
            console.log(`🔄 Check Next Round: ThemeCount=${game.themeRoundCount}, Limit=3`);

            if (game.themeRoundCount >= 3) {
                game.status = GameStatus.THEME_COMPLETED;

                // CALCULAR VENCEDOR DO TEMA (User-based)
                // Somar scores do histórico para o tema atual por userId
                const themeScores = {};
                const currentThemeId = game.activeThemeId;

                game.history.forEach(round => {
                    if (round.themeId === currentThemeId && round.winnerUserId) {
                        themeScores[round.winnerUserId] = (themeScores[round.winnerUserId] || 0) + (round.scoreGained || 0);
                    }
                });

                let bestScore = -1;
                let bestUserId = null;

                Object.entries(themeScores).forEach(([uId, score]) => {
                    if (score > bestScore) {
                        bestScore = score;
                        bestUserId = uId;
                    }
                });

                // Fallback se empatado ou sem scores: Vencedor da última ronda
                if (!bestUserId) {
                    const lastRound = game.history[game.history.length - 1];
                    bestUserId = lastRound?.winnerUserId;
                }

                game.themeWinnerUserId = bestUserId;

                console.log(`🏁 Tema ${game.activeThemeId} completado. Vencedor (Score Real): ${bestUserId} (${bestScore} pts).`);

                // Adicionar tema aos jogados se não tiver
                if (game.activeThemeId && !game.playedThemes.includes(game.activeThemeId)) {
                    game.playedThemes.push(game.activeThemeId);
                }

                // CHECK GAME OVER (All Themes Played)
                // TOTAL_THEMES definido como 11 (número de entradas em cenarios.json)
                const TOTAL_THEMES = 11;

                // Se já jogámos todos os temas
                if (game.playedThemes.length >= TOTAL_THEMES) {
                    game.status = GameStatus.GAME_FINISHED;

                    // Calcular Vencedor Global
                    const globalScores = {};
                    game.history.forEach(round => {
                        if (round.winnerUserId) {
                            globalScores[round.winnerUserId] = (globalScores[round.winnerUserId] || 0) + (round.scoreGained || 0);
                        }
                    });

                    let bestGlobalScore = -1;
                    let bestGlobalUserId = null;

                    Object.entries(globalScores).forEach(([uId, score]) => {
                        if (score > bestGlobalScore) {
                            bestGlobalScore = score;
                            bestGlobalUserId = uId;
                        }
                    });

                    game.globalWinnerUserId = bestGlobalUserId;
                    game.finalScores = globalScores; // Opcional: enviar scores finais

                    console.log(`🏆 JOGO TERMINADO. Vencedor Global: ${bestGlobalUserId} (${bestGlobalScore} pts).`);
                }
            } else {
                // Iniciar nova ronda do mesmo tema
                game.roundNumber++;
                game.themeRoundCount++; // Incrementar rondas do tema
                game.status = GameStatus.ATTACKING;
                game.themeWinnerUserId = null; // Reset

                // Clear round data
                game.currentRound = {
                    attackerTool: null,
                    defenderTool: null,
                    startTime: null,
                    endTime: null
                };
                console.log(`🔄 Nova ronda iniciada. ThemeCount agora é ${game.themeRoundCount}. TotalRound=${game.roundNumber}. Status=ATTACKING`);
            }

            game.updatedAt = Date.now();
            io.to(sessionId).emit('game_state', toClientState(game));

            // Se for nova ronda de ataque, notificar que está pronto
            if (game.status === GameStatus.ATTACKING) {
                io.to(sessionId).emit('next_round_ready');
            }
        };

        /**
         * NEXT_ROUND - Avançar para próxima ronda (Fall back legacy ou para Theme Selection)
         */
        socket.on('next_round', () => {
            if (!currentSessionId) return;
            const game = games.get(currentSessionId);
            if (!game) return;

            // Se estivermos em theme completed, talvez não queiramos disparar nova ronda aqui
            // Mas para compatibilidade com código existente, mantemos
            // Se for R3 -> Theme Completed, ok.
            // Se for R<3, vamos forçar uma escolha de role?
            // Com a nova lógica, next_round direto NÃO deve ser chamado antes da escolha.
            // Mas, deixamos como está por agora, o front-end é que decide quem chama o quê.
            // Se o user clicar "Proxima Ronda" e não houver vencedor definido (ou bug), isto serve de fallback
            handleNextRound(game, currentSessionId);
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

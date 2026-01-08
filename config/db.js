/**
 * Configuração da conexão com MongoDB Atlas
 * 
 * Este módulo estabelece a conexão com a base de dados MongoDB.
 * A connection string é lida da variável de ambiente MONGODB_URI.
 */

const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        // Verificar se a URI está definida
        if (!process.env.MONGODB_URI) {
            console.warn('⚠️  MONGODB_URI não definida. A usar modo sem persistência.');
            return null;
        }

        const conn = await mongoose.connect(process.env.MONGODB_URI, {
            // Opções recomendadas para MongoDB Atlas
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });

        console.log(`✅ MongoDB conectado: ${conn.connection.host}`);
        return conn;
    } catch (error) {
        console.error(`❌ Erro ao conectar MongoDB: ${error.message}`);
        // Não termina o processo - permite funcionar sem DB (apenas em memória)
        console.warn('⚠️  Servidor vai funcionar sem persistência de dados.');
        return null;
    }
};

module.exports = connectDB;

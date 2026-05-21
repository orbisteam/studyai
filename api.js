const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { spawn } = require('child_process');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const pdfParse = require('pdf-parse');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 8000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const DB_PATH = './ass.db';

const publicDir = path.join(__dirname, 'public');
const certificateTemplateDir = path.join(__dirname, 'certificate-template');
const materialsDir = path.join(__dirname, 'materials');

if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
}

if (!fs.existsSync(certificateTemplateDir)) {
    fs.mkdirSync(certificateTemplateDir, { recursive: true });
}

if (!fs.existsSync(materialsDir)) {
    fs.mkdirSync(materialsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, materialsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'material-' + uniqueSuffix + '.pdf');
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Apenas arquivos PDF são permitidos'));
        }
    }
});

app.use(express.static(publicDir));
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const db = new sqlite3.Database(DB_PATH);

const rateLimitStore = new Map();

const checkRateLimit = (userId, action, windowMs, maxRequests) => {
    const now = Date.now();
    const key = `${userId}_${action}`;

    if (!rateLimitStore.has(key)) {
        rateLimitStore.set(key, {
            count: 1,
            firstRequest: now,
            lastRequest: now
        });
        return { allowed: true, remaining: maxRequests - 1, resetTime: now + windowMs };
    }

    const userLimit = rateLimitStore.get(key);

    if (now - userLimit.firstRequest > windowMs) {
        userLimit.count = 1;
        userLimit.firstRequest = now;
        userLimit.lastRequest = now;
        rateLimitStore.set(key, userLimit);
        return { allowed: true, remaining: maxRequests - 1, resetTime: now + windowMs };
    }

    if (userLimit.count < maxRequests) {
        userLimit.count++;
        userLimit.lastRequest = now;
        rateLimitStore.set(key, userLimit);
        return { allowed: true, remaining: maxRequests - userLimit.count, resetTime: userLimit.firstRequest + windowMs };
    }

    return {
        allowed: false,
        remaining: 0,
        resetTime: userLimit.firstRequest + windowMs,
        retryAfter: Math.ceil((userLimit.firstRequest + windowMs - now) / 1000)
    };
};

const rateLimitMiddleware = (action, windowMs, maxRequests) => {
    return (req, res, next) => {
        const rateLimit = checkRateLimit(req.user.id, action, windowMs, maxRequests);

        if (!rateLimit.allowed) {
            return res.status(429).json({
                error: `Aguarde ${rateLimit.retryAfter} segundos antes de gerar novamente`,
                retryAfter: rateLimit.retryAfter
            });
        }

        res.set({
            'X-RateLimit-Limit': maxRequests,
            'X-RateLimit-Remaining': rateLimit.remaining,
            'X-RateLimit-Reset': Math.ceil(rateLimit.resetTime / 1000)
        });

        next();
    };
};

setInterval(() => {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    for (const [key, data] of rateLimitStore.entries()) {
        if (now - data.lastRequest > oneHour) {
            rateLimitStore.delete(key);
        }
    }
}, 30 * 60 * 1000);

const generateRandomId = () => {
    return crypto.randomBytes(16).toString('hex').toUpperCase();
};

const generateCertificateCode = () => {
    const parts = [];
    for (let i = 0; i < 3; i++) {
        let part = '';
        for (let j = 0; j < 4; j++) {
            part += Math.floor(Math.random() * 9) + 1;
        }
        parts.push(part);
    }
    return parts.join('-');
};

const generateUniqueId = () => {
    return crypto.randomBytes(16).toString('hex');
};

const initializeCertificateTemplate = () => {
    const templatePath = path.join(certificateTemplateDir, 'template.pdf');
    if (!fs.existsSync(templatePath)) {
        const doc = new PDFDocument({
            layout: 'landscape',
            size: 'A4'
        });

        const writeStream = fs.createWriteStream(templatePath);
        doc.pipe(writeStream);

        doc.rect(0, 0, doc.page.width, doc.page.height).fill('#0f172a');

        doc.fillColor('#f1f5f9')
           .fontSize(36)
           .text('CERTIFICADO DE CONCLUSÃO', 0, 100, { align: 'center' });

        doc.moveDown(2);
        doc.fontSize(20)
           .text('Conferimos a', { align: 'center' });

        doc.moveDown();
        doc.fontSize(28)
           .text('{{FULL_NAME}}', { align: 'center' });

        doc.moveDown();
        doc.fontSize(18)
           .text('pela conclusão com êxito do tema de estudo', { align: 'center' });

        doc.moveDown();
        doc.fontSize(24)
           .fillColor('#6366f1')
           .text('{{THEME_NAME}}', { align: 'center' });

        doc.moveDown(2);
        doc.fillColor('#f1f5f9')
           .fontSize(14)
           .text(`Código do certificado: {{CERTIFICATE_CODE}}`, { align: 'center' });

        doc.text(`Tag: {{TAG}}`, { align: 'center' });
        doc.text(`Data de emissão: {{ISSUE_DATE}}`, { align: 'center' });

        doc.moveDown(4);
        doc.fontSize(12)
           .fillColor('#94a3b8')
           .text('StudyAI - Plataforma de Estudo Inteligente', { align: 'center' });

        doc.end();
    }
};

initializeCertificateTemplate();

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT UNIQUE NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        role TEXT DEFAULT 'student',
        teacher_user_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME,
        is_active INTEGER DEFAULT 1,
        user_code TEXT UNIQUE,
        profile_picture TEXT,
        bio TEXT,
        nick TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS user_profiles (
        user_id INTEGER PRIMARY KEY,
        full_name TEXT,
        age INTEGER,
        interests TEXT,
        learning_goals TEXT,
        preferred_learning_style TEXT,
        time_availability INTEGER,
        current_level TEXT DEFAULT 'beginner',
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS study_themes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        theme_id TEXT UNIQUE NOT NULL,
        user_id INTEGER NOT NULL,
        theme_name TEXT NOT NULL,
        description TEXT,
        tag TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active INTEGER DEFAULT 1,
        current_topic_index INTEGER DEFAULT 0,
        theme_code TEXT UNIQUE,
        material_file_path TEXT,
        material_text_content TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS learning_paths (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic_id TEXT UNIQUE NOT NULL,
        user_id INTEGER NOT NULL,
        theme_id INTEGER NOT NULL,
        topic_code TEXT UNIQUE,
        topic_name TEXT NOT NULL,
        topic_description TEXT,
        topic_order INTEGER NOT NULL,
        difficulty TEXT DEFAULT 'beginner',
        status TEXT DEFAULT 'pending',
        progress INTEGER DEFAULT 0,
        lessons_completed INTEGER DEFAULT 0,
        quizzes_completed INTEGER DEFAULT 0,
        exams_completed INTEGER DEFAULT 0,
        completed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(theme_id) REFERENCES study_themes(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS study_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        theme_id INTEGER NOT NULL,
        topic_id INTEGER NOT NULL,
        session_id TEXT UNIQUE,
        session_type TEXT NOT NULL,
        content_data TEXT,
        score REAL DEFAULT 0,
        time_spent INTEGER DEFAULT 0,
        completed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'completed',
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(theme_id) REFERENCES study_themes(id),
        FOREIGN KEY(topic_id) REFERENCES learning_paths(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS assessments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        theme_id INTEGER NOT NULL,
        topic_id INTEGER NOT NULL,
        assessment_id TEXT UNIQUE,
        assessment_type TEXT NOT NULL,
        questions TEXT NOT NULL,
        correct_answers TEXT NOT NULL,
        user_answers TEXT,
        score REAL DEFAULT 0,
        total_questions INTEGER DEFAULT 0,
        correct_count INTEGER DEFAULT 0,
        time_spent INTEGER DEFAULT 0,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        status TEXT DEFAULT 'in_progress',
        analysis_data TEXT,
        is_annulled INTEGER DEFAULT 0,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(theme_id) REFERENCES study_themes(id),
        FOREIGN KEY(topic_id) REFERENCES learning_paths(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS assessment_questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assessment_id TEXT NOT NULL,
        question_index INTEGER NOT NULL,
        is_annulled INTEGER DEFAULT 0,
        validated INTEGER DEFAULT 0,
        FOREIGN KEY(assessment_id) REFERENCES assessments(assessment_id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS progress_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        theme_id INTEGER NOT NULL,
        topic_id INTEGER NOT NULL,
        metric_type TEXT NOT NULL,
        metric_value REAL NOT NULL,
        recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        notes TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(theme_id) REFERENCES study_themes(id),
        FOREIGN KEY(topic_id) REFERENCES learning_paths(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS error_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        theme_id INTEGER NOT NULL,
        topic_id INTEGER NOT NULL,
        session_id TEXT,
        assessment_id TEXT,
        error_type TEXT NOT NULL,
        error_description TEXT NOT NULL,
        correct_answer TEXT,
        user_answer TEXT,
        occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved INTEGER DEFAULT 0,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(theme_id) REFERENCES study_themes(id),
        FOREIGN KEY(topic_id) REFERENCES learning_paths(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS achievements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        achievement_type TEXT NOT NULL,
        achievement_name TEXT NOT NULL,
        achievement_description TEXT,
        achieved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        points INTEGER DEFAULT 0,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS user_preferences (
        user_id INTEGER PRIMARY KEY,
        theme TEXT DEFAULT 'dark',
        language TEXT DEFAULT 'portuguese',
        notifications_enabled INTEGER DEFAULT 1,
        daily_goal INTEGER DEFAULT 60,
        weekly_goal INTEGER DEFAULT 300,
        auto_save INTEGER DEFAULT 1,
        difficulty_preference TEXT DEFAULT 'adaptive',
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS help_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        session_id TEXT,
        assessment_id TEXT,
        help_count INTEGER DEFAULT 0,
        max_help_count INTEGER DEFAULT 2,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS certificates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        theme_id INTEGER NOT NULL,
        certificate_code TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        theme_name TEXT NOT NULL,
        tag TEXT,
        issue_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        pdf_generated INTEGER DEFAULT 0,
        pdf_hash TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(theme_id) REFERENCES study_themes(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS forum_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        tag TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS forum_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        is_pinned INTEGER DEFAULT 0,
        view_count INTEGER DEFAULT 0,
        reply_count INTEGER DEFAULT 0,
        last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(category_id) REFERENCES forum_categories(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS forum_replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        is_solution INTEGER DEFAULT 0,
        grade REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        edited_at DATETIME,
        is_removed INTEGER DEFAULT 0,
        FOREIGN KEY(post_id) REFERENCES forum_posts(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS forum_moderation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reply_id INTEGER NOT NULL,
        moderator_id INTEGER NOT NULL,
        action_type TEXT NOT NULL,
        previous_content TEXT,
        grade_value REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(reply_id) REFERENCES forum_replies(id),
        FOREIGN KEY(moderator_id) REFERENCES users(id)
    )`);
});

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token de acesso requerido' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token inválido' });
        }

        db.get('SELECT id, user_id, username, role, is_active, user_code FROM users WHERE id = ?', [user.userId], (err, userData) => {
            if (err || !userData || !userData.is_active) {
                return res.status(403).json({ error: 'Usuário não encontrado ou inativo' });
            }
            req.user = userData;
            next();
        });
    });
};

const requireRole = (roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        next();
    };
};

const callAIService = (payload) => {
    return new Promise((resolve, reject) => {
        const pythonScriptPath = path.join(__dirname, 'ia_service.py');
        const pythonProcess = spawn('python3', [pythonScriptPath, JSON.stringify(payload)]);

        let result = '';
        let error = '';

        pythonProcess.stdout.on('data', (data) => {
            result += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            error += data.toString();
        });

        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`Python process error: ${error}`));
                return;
            }
            try {
                const parsedResult = JSON.parse(result);
                resolve(parsedResult);
            } catch (e) {
                reject(new Error('Failed to parse AI response: ' + e.message + ' - Response: ' + result));
            }
        });
    });
};

const calculateUserLevel = (userId) => {
    return new Promise((resolve) => {
        db.get(`
            SELECT AVG(score) as avg_score, COUNT(*) as assessment_count
            FROM assessments
            WHERE user_id = ? AND status = 'completed' AND is_annulled = 0
        `, [userId], (err, result) => {
            if (err || !result.assessment_count) {
                resolve('beginner');
                return;
            }

            const avgScore = result.avg_score;
            let level = 'beginner';

            if (avgScore >= 90 && result.assessment_count >= 10) level = 'expert';
            else if (avgScore >= 80 && result.assessment_count >= 5) level = 'advanced';
            else if (avgScore >= 70 && result.assessment_count >= 3) level = 'intermediate';
            else if (avgScore >= 60) level = 'elementary';

            resolve(level);
        });
    });
};

const updateUserProgress = (userId, themeId, topicId, score, metricType = 'assessment_score') => {
    db.run(`
        INSERT INTO progress_metrics (user_id, theme_id, topic_id, metric_type, metric_value, recorded_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [userId, themeId, topicId, metricType, score]);

    calculateUserLevel(userId).then(level => {
        db.run('UPDATE user_profiles SET current_level = ? WHERE user_id = ?', [level, userId]);
    });
};

const analyzeAssessmentResults = async (userId, themeId, topicId, assessmentId, questions, userAnswers, correctAnswers) => {
    try {
        let questionsObj;
        let userAnswersObj;
        let correctAnswersObj;

        try {
            questionsObj = typeof questions === 'string' ? JSON.parse(questions) : questions;
            userAnswersObj = typeof userAnswers === 'string' ? JSON.parse(userAnswers) : userAnswers;
            correctAnswersObj = typeof correctAnswers === 'string' ? JSON.parse(correctAnswers) : correctAnswers;
        } catch (parseError) {
            console.error('Erro ao fazer parse dos dados:', parseError);
            return {
                erros_comuns: ["Erro na análise dos dados da avaliação"],
                soluções: ["Recarregue a avaliação e tente novamente"],
                recomendações: ["Entre em contato com o suporte técnico se o problema persistir"]
            };
        }

        if (!questionsObj || typeof questionsObj !== 'object') {
            console.error('questionsObj inválido:', questionsObj);
            return {
                erros_comuns: ["Dados das questões inválidos"],
                soluções: ["Recarregue a avaliação e tente novamente"],
                recomendações: ["Entre em contato com o suporte técnico"]
            };
        }

        let questionsArray;
        if (Array.isArray(questionsObj)) {
            questionsArray = questionsObj;
        } else if (questionsObj.perguntas && Array.isArray(questionsObj.perguntas)) {
            questionsArray = questionsObj.perguntas;
        } else if (questionsObj.questions && Array.isArray(questionsObj.questions)) {
            questionsArray = questionsObj.questions;
        } else {
            console.error('Formato de questões não suportado:', questionsObj);
            return {
                erros_comuns: ["Formato das questões não é suportado"],
                soluções: ["A avaliação precisa ser regenerada"],
                recomendações: ["Gere uma nova avaliação para este tópico"]
            };
        }

        if (!Array.isArray(userAnswersObj)) {
            userAnswersObj = [];
        }

        if (!Array.isArray(correctAnswersObj)) {
            correctAnswersObj = [];
        }

        let errorAnalysis = [];

        for (let i = 0; i < questionsArray.length; i++) {
            const question = questionsArray[i];
            const userAnswer = userAnswersObj[i];
            const correctAnswer = correctAnswersObj[i];

            if (userAnswer !== correctAnswer) {
                const errorDetail = {
                    question: question.pergunta || question.question || `Questão ${i + 1}`,
                    userAnswer: userAnswer,
                    correctAnswer: correctAnswer,
                    options: question.opções || question.options || []
                };
                errorAnalysis.push(errorDetail);

                db.run(`
                    INSERT INTO error_logs (user_id, theme_id, topic_id, assessment_id, error_type, error_description, correct_answer, user_answer)
                    VALUES (?, ?, ?, ?, 'assessment_error', ?, ?, ?)
                `, [userId, themeId, topicId, assessmentId, `Resposta incorreta na questão ${i + 1}`, correctAnswer, userAnswer]);
            }
        }

        if (errorAnalysis.length === 0) {
            return {
                erros_comuns: ["Nenhum erro identificado - excelente desempenho!"],
                soluções: ["Continue mantendo esse nível de atenção e estudo"],
                recomendações: ["Avance para o próximo tópico ou desafio"]
            };
        }

        const analysisPayload = {
            tipo: 'sumarização_de_erros',
            conteúdo_estudo: 'Análise de erros da avaliação',
            erros_anteriores: errorAnalysis,
            outras_informações: {
                assessment_id: assessmentId,
                total_questions: questionsArray.length,
                correct_count: questionsArray.length - errorAnalysis.length
            }
        };

        try {
            const aiAnalysis = await callAIService(analysisPayload);

            if (aiAnalysis.error) {
                throw new Error(aiAnalysis.error);
            }

            db.run('UPDATE assessments SET analysis_data = ? WHERE assessment_id = ?',
                [JSON.stringify(aiAnalysis), assessmentId]);

            return aiAnalysis;
        } catch (aiError) {
            console.error('Erro na análise da IA:', aiError);

            const fallbackAnalysis = {
                erros_comuns: errorAnalysis.map(e => `Erro na questão: "${e.question.substring(0, 100)}..."`),
                soluções: ["Revise o conteúdo correspondente às questões erradas", "Pratique com exercícios similares"],
                recomendações: ["Consulte o material de estudo novamente", "Peça ajuda ao professor se necessário"]
            };

            db.run('UPDATE assessments SET analysis_data = ? WHERE assessment_id = ?',
                [JSON.stringify(fallbackAnalysis), assessmentId]);

            return fallbackAnalysis;
        }
    } catch (error) {
        console.error('Error in assessment analysis:', error);
        return {
            erros_comuns: ["Erro na análise dos resultados"],
            soluções: ["Revise as questões manualmente"],
            recomendações: ["Consulte o material de estudo novamente"]
        };
    }
};

const getCurrentLearningTopic = (userId, themeId) => {
    return new Promise((resolve, reject) => {
        db.get(`
            SELECT lp.*, st.theme_name
            FROM learning_paths lp
            JOIN study_themes st ON lp.theme_id = st.id
            WHERE lp.user_id = ? AND lp.theme_id = ? AND lp.status != 'completed'
            ORDER BY lp.topic_order ASC
            LIMIT 1
        `, [userId, themeId], (err, topic) => {
            if (err) reject(err);
            else resolve(topic);
        });
    });
};

const updateTopicProgress = (userId, themeId, topicId, progressData) => {
    return new Promise((resolve, reject) => {
        const { progress, lessons_completed, quizzes_completed, exams_completed, status } = progressData;
        const completedAt = status === 'completed' ? 'CURRENT_TIMESTAMP' : 'NULL';

        db.run(`
            UPDATE learning_paths
            SET progress = ?, lessons_completed = ?, quizzes_completed = ?, exams_completed = ?,
                status = ?, completed_at = ${completedAt}
            WHERE user_id = ? AND theme_id = ? AND id = ?
        `, [progress, lessons_completed, quizzes_completed, exams_completed, status, userId, themeId, topicId], function(err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
};

const getTopicProgress = (userId, themeId) => {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT lp.*
            FROM learning_paths lp
            WHERE lp.user_id = ? AND lp.theme_id = ?
            ORDER BY lp.topic_order ASC
        `, [userId, themeId], (err, topics) => {
            if (err) reject(err);
            else resolve(topics || []);
        });
    });
};

const canTakeQuiz = (userId, topicId) => {
    return new Promise((resolve) => {
        db.get(`
            SELECT COUNT(*) as lesson_count
            FROM study_sessions
            WHERE user_id = ? AND topic_id = ? AND session_type = 'lesson' AND status = 'completed'
        `, [userId, topicId], (err, result) => {
            resolve(result.lesson_count > 0);
        });
    });
};

const canTakeExam = (userId, topicId) => {
    return new Promise((resolve) => {
        db.get(`
            SELECT COUNT(*) as quiz_count
            FROM assessments
            WHERE user_id = ? AND topic_id = ? AND assessment_type = 'quiz' AND status = 'completed' AND score >= 50 AND is_annulled = 0
        `, [userId, topicId], (err, result) => {
            resolve(result.quiz_count >= 3);
        });
    });
};

const extractCorrectAnswerLetter = (userAnswer, options) => {
    if (!userAnswer || !options) return null;

    const cleanUserAnswer = userAnswer.toString().trim();

    for (let i = 0; i < options.length; i++) {
        const option = options[i].toString().trim();
        if (option.startsWith(cleanUserAnswer + ')') || option === cleanUserAnswer) {
            const letter = option.split(")")[0].trim();
            return letter;
        }
    }

    return cleanUserAnswer.length === 1 ? cleanUserAnswer : null;
};

const getHelpSession = (userId, sessionId, assessmentId) => {
    return new Promise((resolve) => {
        let query = 'SELECT * FROM help_sessions WHERE user_id = ? ';
        let params = [userId];

        if (sessionId) {
            query += ' AND session_id = ?';
            params.push(sessionId);
        } else if (assessmentId) {
            query += ' AND assessment_id = ?';
            params.push(assessmentId);
        }

        db.get(query, params, (err, result) => {
            if (err || !result) {
                resolve(null);
            } else {
                resolve(result);
            }
        });
    });
};

const createHelpSession = (userId, sessionId, assessmentId, maxHelpCount = 2) => {
    return new Promise((resolve) => {
        db.run(`INSERT INTO help_sessions (user_id, session_id, assessment_id, max_help_count)
                VALUES (?, ?, ?, ?)`,
            [userId, sessionId, assessmentId, maxHelpCount], function(err) {
            if (err) {
                resolve(null);
            } else {
                resolve({
                    id: this.lastID,
                    user_id: userId,
                    session_id: sessionId,
                    assessment_id: assessmentId,
                    help_count: 0,
                    max_help_count: maxHelpCount
                });
            }
        });
    });
};

const incrementHelpCount = (helpSessionId) => {
    return new Promise((resolve) => {
        db.run('UPDATE help_sessions SET help_count = help_count + 1 WHERE id = ?',
            [helpSessionId], function(err) {
            resolve(!err);
        });
    });
};

const generateCertificatePDF = (certificate, res) => {
    const doc = new PDFDocument({
        layout: 'landscape',
        size: 'A4'
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=certificado-${certificate.certificate_code}.pdf`);

    doc.pipe(res);

    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#0f172a');

    doc.fillColor('#f1f5f9')
       .fontSize(36)
       .text('CERTIFICADO DE CONCLUSÃO', 0, 100, { align: 'center' });

    doc.moveDown(2);
    doc.fontSize(20)
       .text('Conferimos a', { align: 'center' });

    doc.moveDown();
    doc.fontSize(28)
       .text(certificate.full_name, { align: 'center' });

    doc.moveDown();
    doc.fontSize(18)
       .text('pela conclusão com êxito do tema de estudo', { align: 'center' });

    doc.moveDown();
    doc.fontSize(24)
       .fillColor('#6366f1')
       .text(certificate.theme_name, { align: 'center' });

    doc.moveDown(2);
    doc.fillColor('#f1f5f9')
       .fontSize(14)
       .text(`Código do certificado: ${certificate.certificate_code}`, { align: 'center' });

    doc.text(`Tag: ${certificate.tag}`, { align: 'center' });
    doc.text(`Data de emissão: ${new Date(certificate.issue_date).toLocaleDateString('pt-BR')}`, { align: 'center' });

    doc.moveDown(4);
    doc.fontSize(12)
       .fillColor('#94a3b8')
       .text('StudyAI - Plataforma de Estudo Inteligente', { align: 'center' });

    doc.end();
};

const generateCertificateHash = (certificateData) => {
    return crypto.createHash('sha256').update(JSON.stringify({
        certificate_code: certificateData.certificate_code,
        full_name: certificateData.full_name,
        theme_name: certificateData.theme_name,
        tag: certificateData.tag,
        issue_date: certificateData.issue_date
    })).digest('hex');
};

const generateReportPDF = (certificate, assessments, sessions, profile, res) => {
    const doc = new PDFDocument({
        margins: { top: 60, bottom: 60, left: 60, right: 60 },
        size: 'A4',
        bufferPages: true
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=relatorio-${certificate.theme_name.replace(/\s+/g, '-')}-${Date.now()}.pdf`);

    doc.pipe(res);

    doc.rect(0, 0, doc.page.width, 150).fill('#6366f1');
    doc.rect(0, 150, doc.page.width, 10).fill('#8b5cf6');

    doc.fillColor('#ffffff')
       .fontSize(36)
       .font('Helvetica-Bold')
       .text('RELATÓRIO', 0, 45, { align: 'center' });

    doc.fontSize(32)
       .text('ACADÊMICO', 0, 85, { align: 'center' });

    doc.fontSize(10)
       .font('Helvetica')
       .fillColor('#e0e7ff')
       .text(`Gerado em ${new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`, 0, 125, { align: 'center' });

    doc.moveDown(4);

    const infoBoxY = doc.y;
    doc.roundedRect(60, infoBoxY, doc.page.width - 120, 140, 10)
       .fill('#f8fafc');

    doc.fillColor('#1e293b')
       .fontSize(18)
       .font('Helvetica-Bold')
       .text('INFORMAÇÕES DO ALUNO', 80, infoBoxY + 20);

    doc.moveTo(80, infoBoxY + 45)
       .lineTo(doc.page.width - 80, infoBoxY + 45)
       .strokeColor('#cbd5e1')
       .lineWidth(1)
       .stroke();

    doc.fillColor('#475569')
       .fontSize(12)
       .font('Helvetica')
       .text(`Nome:`, 80, infoBoxY + 60);
    doc.fillColor('#1e293b')
       .fontSize(12)
       .font('Helvetica-Bold')
       .text(`${profile?.full_name || certificate.full_name || 'N/A'}`, 180, infoBoxY + 60);

    doc.fillColor('#475569')
       .font('Helvetica')
       .text(`Tema:`, 80, infoBoxY + 80);
    doc.fillColor('#1e293b')
       .font('Helvetica-Bold')
       .text(`${certificate.theme_name}`, 180, infoBoxY + 80, { width: doc.page.width - 260 });

    doc.fillColor('#475569')
       .font('Helvetica')
       .text(`Tag:`, 80, infoBoxY + 100);
    doc.fillColor('#6366f1')
       .font('Helvetica-Bold')
       .text(`${certificate.tag || 'N/A'}`, 180, infoBoxY + 100);

    doc.fillColor('#475569')
       .font('Helvetica')
       .text(`Certificado:`, 80, infoBoxY + 120);
    doc.fillColor('#1e293b')
       .font('Helvetica')
       .fontSize(10)
       .text(`${certificate.certificate_code}`, 180, infoBoxY + 120);

    doc.y = infoBoxY + 160;
    doc.moveDown(1);

    if (assessments && assessments.length > 0) {
        doc.fillColor('#1e293b')
           .fontSize(20)
           .font('Helvetica-Bold')
           .text('RESUMO DE AVALIAÇÕES', 60, doc.y);

        doc.moveTo(60, doc.y + 5)
           .lineTo(200, doc.y + 5)
           .strokeColor('#6366f1')
           .lineWidth(3)
           .stroke();

        doc.moveDown(1.5);

        let totalScore = 0;
        let totalQuestions = 0;
        let totalCorrect = 0;

        assessments.forEach((assessment, index) => {
            if (doc.y > 700) {
                doc.addPage();
                doc.y = 50;
            }

            doc.fillColor('#6366f1')
               .fontSize(13)
               .text(`${index + 1}. ${assessment.assessment_type === 'quiz' ? 'Simulado' : 'Prova'} - ${new Date(assessment.completed_at).toLocaleDateString('pt-BR')}`, 50, doc.y, { underline: true });

            doc.moveDown(0.5);

            doc.fillColor('#374151')
               .fontSize(11);

            const scoreColor = assessment.score >= 70 ? '#10b981' : assessment.score >= 50 ? '#f59e0b' : '#ef4444';
            doc.fillColor(scoreColor)
               .text(`Pontuação: ${assessment.score.toFixed(2)}%`, 50, doc.y);

            doc.fillColor('#374151')
               .text(`Questões Corretas: ${assessment.correct_count}/${assessment.total_questions}`, 50, doc.y);
            doc.text(`Tempo Gasto: ${Math.round(assessment.time_spent / 60)} minutos`, 50, doc.y);

            let questions = [];
            let userAnswers = [];
            let correctAnswers = [];

            try {
                questions = typeof assessment.questions === 'string' ? JSON.parse(assessment.questions) : assessment.questions;
                userAnswers = assessment.user_answers ? (typeof assessment.user_answers === 'string' ? JSON.parse(assessment.user_answers) : assessment.user_answers) : [];
                correctAnswers = typeof assessment.correct_answers === 'string' ? JSON.parse(assessment.correct_answers) : assessment.correct_answers;

                if (!Array.isArray(questions)) {
                    if (questions.perguntas) questions = questions.perguntas;
                    else if (questions.questions) questions = questions.questions;
                    else questions = [];
                }

                if (!Array.isArray(userAnswers)) userAnswers = [];
                if (!Array.isArray(correctAnswers)) correctAnswers = [];
            } catch (e) {
                console.error('Erro ao processar dados da avaliação:', e);
                questions = [];
                userAnswers = [];
                correctAnswers = [];
            }

            doc.moveDown(0.5);
            doc.fontSize(10)
               .fillColor('#6b7280')
               .text('Detalhamento:', 50, doc.y);

            questions.forEach((question, qIndex) => {
                if (doc.y > 750) {
                    doc.addPage();
                    doc.y = 50;
                }

                const isCorrect = userAnswers[qIndex] === correctAnswers[qIndex];
                const questionText = question.pergunta || question.question || `Questão ${qIndex + 1}`;
                doc.fontSize(9)
                   .fillColor(isCorrect ? '#10b981' : '#ef4444')
                   .text(`Q${qIndex + 1}: ${questionText.substring(0, 80)}${questionText.length > 80 ? '...' : ''}`, 60, doc.y);
                doc.fillColor('#6b7280')
                   .fontSize(8)
                   .text(`Resposta: ${userAnswers[qIndex] || 'Não respondida'} | Correta: ${correctAnswers[qIndex]}`, 60, doc.y);
                doc.moveDown(0.3);
            });

            if (assessment.analysis_data) {
                let analysis;
                try {
                    analysis = typeof assessment.analysis_data === 'string' ? JSON.parse(assessment.analysis_data) : assessment.analysis_data;
                } catch (e) {
                    analysis = {};
                }

                doc.moveDown(0.5);
                doc.fontSize(10)
                   .fillColor('#6366f1')
                   .text('Análise:', 50, doc.y);

                if (analysis.erros_comuns && Array.isArray(analysis.erros_comuns) && analysis.erros_comuns.length > 0) {
                    doc.fillColor('#ef4444')
                       .fontSize(9)
                       .text('Erros Comuns:', 60, doc.y);
                    analysis.erros_comuns.forEach(erro => {
                        doc.fillColor('#6b7280')
                           .fontSize(8)
                           .text(`• ${erro.substring(0, 100)}${erro.length > 100 ? '...' : ''}`, 70, doc.y);
                        doc.moveDown(0.2);
                    });
                }

                if (analysis.soluções && Array.isArray(analysis.soluções) && analysis.soluções.length > 0) {
                    doc.moveDown(0.3);
                    doc.fillColor('#10b981')
                       .fontSize(9)
                       .text('Sugestões:', 60, doc.y);
                    analysis.soluções.forEach(solucao => {
                        doc.fillColor('#6b7280')
                           .fontSize(8)
                           .text(`• ${solucao.substring(0, 100)}${solucao.length > 100 ? '...' : ''}`, 70, doc.y);
                        doc.moveDown(0.2);
                    });
                }
            }

            totalScore += assessment.score;
            totalQuestions += assessment.total_questions;
            totalCorrect += assessment.correct_count;

            doc.moveDown(1);
        });

        if (assessments.length > 0) {
            if (doc.y > 700) {
                doc.addPage();
                doc.y = 50;
            }

            doc.moveDown(1);

            const statsY = doc.y;
            doc.roundedRect(60, statsY, doc.page.width - 120, 140, 10)
               .fill('#f0f9ff');

            doc.fillColor('#1e293b')
               .fontSize(18)
               .font('Helvetica-Bold')
               .text('ESTATÍSTICAS GERAIS', 80, statsY + 20);

            doc.moveTo(80, statsY + 45)
               .lineTo(doc.page.width - 80, statsY + 45)
               .strokeColor('#bae6fd')
               .lineWidth(1)
               .stroke();

            const avgScore = (totalScore / assessments.length).toFixed(2);
            const successRate = ((totalCorrect / totalQuestions) * 100).toFixed(2);
            const totalHours = (sessions.reduce((sum, s) => sum + (s.time_spent || 0), 0) / 3600).toFixed(2);

            doc.roundedRect(80, statsY + 60, 130, 60, 8)
               .fillAndStroke('#6366f1', '#6366f1');
            doc.fillColor('#ffffff')
               .fontSize(24)
               .font('Helvetica-Bold')
               .text(`${avgScore}%`, 90, statsY + 70, { width: 110, align: 'center' });
            doc.fontSize(10)
               .font('Helvetica')
               .text('Nota Média', 90, statsY + 100, { width: 110, align: 'center' });

            doc.roundedRect(220, statsY + 60, 130, 60, 8)
               .fillAndStroke('#10b981', '#10b981');
            doc.fillColor('#ffffff')
               .fontSize(24)
               .font('Helvetica-Bold')
               .text(`${successRate}%`, 230, statsY + 70, { width: 110, align: 'center' });
            doc.fontSize(10)
               .font('Helvetica')
               .text('Taxa de Acerto', 230, statsY + 100, { width: 110, align: 'center' });

            doc.roundedRect(360, statsY + 60, 130, 60, 8)
               .fillAndStroke('#f59e0b', '#f59e0b');
            doc.fillColor('#ffffff')
               .fontSize(24)
               .font('Helvetica-Bold')
               .text(`${totalHours}h`, 370, statsY + 70, { width: 110, align: 'center' });
            doc.fontSize(10)
               .font('Helvetica')
               .text('Tempo Total', 370, statsY + 100, { width: 110, align: 'center' });

            doc.y = statsY + 155;
        }
    }

    if (sessions && sessions.length > 0) {
        if (doc.y > 700) {
            doc.addPage();
            doc.y = 50;
        }

        doc.moveDown(2);
        doc.fillColor('#1e293b')
           .fontSize(20)
           .font('Helvetica-Bold')
           .text('LIÇÕES COMPLETADAS', 60, doc.y);

        doc.moveTo(60, doc.y + 5)
           .lineTo(200, doc.y + 5)
           .strokeColor('#10b981')
           .lineWidth(3)
           .stroke();

        doc.moveDown(1.5);

        sessions.forEach((session, index) => {
            if (doc.y > 750) {
                doc.addPage();
                doc.y = 50;
            }

            doc.fillColor('#6366f1')
               .fontSize(12)
               .text(`${index + 1}. ${session.topic_name}`, 50, doc.y);

            doc.moveDown(0.3);
            doc.fillColor('#6b7280')
               .fontSize(10)
               .text(`Data: ${new Date(session.created_at).toLocaleDateString('pt-BR')} | Tempo: ${Math.round(session.time_spent / 60)} minutos`, 50, doc.y);

            if (session.content_data) {
                try {
                    const content = typeof session.content_data === 'string' ? JSON.parse(session.content_data) : session.content_data;
                    if (content.objetivos && Array.isArray(content.objetivos)) {
                        doc.moveDown(0.3);
                        doc.fillColor('#374151')
                           .fontSize(9)
                           .text('Objetivos:', 60, doc.y);
                        content.objetivos.forEach(obj => {
                            doc.fillColor('#6b7280')
                               .fontSize(8)
                               .text(`• ${obj}`, 70, doc.y);
                            doc.moveDown(0.2);
                        });
                    }
                } catch (e) {
                }
            }

            doc.moveDown(0.8);
        });
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);

        doc.rect(0, doc.page.height - 50, doc.page.width, 50)
           .fill('#f8fafc');

        doc.fillColor('#64748b')
           .fontSize(9)
           .font('Helvetica')
           .text('StudyAI - Plataforma de Estudo Inteligente', 60, doc.page.height - 35);

        doc.fillColor('#94a3b8')
           .fontSize(8)
           .text(`Página ${i + 1} de ${range.count}`, 0, doc.page.height - 35, { align: 'right', width: doc.page.width - 60 });
    }

    doc.end();
};

app.post('/register', async (req, res) => {
    const { username, password, email, full_name, age, interests, learning_goals, preferred_learning_style, time_availability, role, teacher_id } = req.body;

    if (!username || !password || !email) {
        return res.status(400).json({ error: 'Username, password e email são obrigatórios' });
    }

    if (password.length < 8) {
        return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres' });
    }

    if (age && (age < 1 || age > 125)) {
        return res.status(400).json({ error: 'Idade deve ser entre 1 e 125 anos' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 12);
        const userId = generateRandomId();

        db.get("SELECT COUNT(*) as count FROM users", (err, result) => {
            const userRole = result.count === 0 ? 'admin' : (role === 'teacher' ? 'teacher' : 'student');
            const userCode = generateRandomId();

            let teacherUserId = null;
            if (teacher_id && userRole === 'student') {
                teacherUserId = teacher_id;
            }

            db.run('INSERT INTO users (user_id, username, password, email, role, teacher_user_id, user_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [userId, username, hashedPassword, email, userRole, teacherUserId, userCode], function(err) {
                if (err) {
                    return res.status(400).json({ error: 'Usuário ou email já existe' });
                }

                const dbUserId = this.lastID;

                db.run(`INSERT INTO user_profiles (user_id, full_name, age, interests, learning_goals, preferred_learning_style, time_availability)
                        VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [dbUserId, full_name, age, JSON.stringify(interests), JSON.stringify(learning_goals), preferred_learning_style, time_availability],
                    (err) => {
                    if (err) {
                        return res.status(500).json({ error: 'Erro ao criar perfil' });
                    }

                    db.run('INSERT INTO user_preferences (user_id) VALUES (?)', [dbUserId]);

                    const token = jwt.sign({ userId: dbUserId, username: username }, JWT_SECRET);

                    res.status(201).json({
                        message: 'Usuário criado com sucesso',
                        token: token,
                        user: {
                            id: dbUserId,
                            user_id: userId,
                            username: username,
                            email: email,
                            role: userRole,
                            user_code: userCode,
                            teacher_user_id: teacherUserId
                        }
                    });
                });
            });
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    console.log("BODY:", req.body);
    console.log("HEADERS:", req.headers);

    if (!username || !password) {
        return res.status(400).json({ error: 'Username e password são obrigatórios' });
    }

    db.get('SELECT * FROM users WHERE username = ? AND is_active = 1', [username], async (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Erro interno do servidor' });
        }

        if (!user) {
            return res.status(400).json({ error: 'Credenciais inválidas' });
        }

        try {
            if (await bcrypt.compare(password, user.password)) {
                const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET);

                db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

                db.get(`SELECT up.*, pref.*
                        FROM user_profiles up
                        LEFT JOIN user_preferences pref ON up.user_id = pref.user_id
                        WHERE up.user_id = ?`, [user.id], (err, profile) => {

                    console.log("LOGIN SUCCESS");
                    res.json({
                        token: token,
                        user: {
                            id: user.id,
                            user_id: user.user_id,
                            username: user.username,
                            email: user.email,
                            role: user.role,
                            teacher_user_id: user.teacher_user_id,
                            user_code: user.user_code,
                            profile_picture: user.profile_picture,
                            bio: user.bio,
                            nick: user.nick,
                            profile: profile
                        }
                    });
                });
            } else {
                res.status(400).json({ error: 'Credenciais inválidas' });
            }
        } catch (error) {
            res.status(500).json({ error: 'Erro interno do servidor' });
        }
    });
});

app.get('/user/profile', authenticateToken, (req, res) => {
    db.get(`SELECT u.id, u.user_id, u.username, u.email, u.role, u.teacher_user_id, u.created_at, u.last_login, u.user_code,
                   u.profile_picture, u.bio, u.nick,
                   up.full_name, up.age, up.interests, up.learning_goals, up.preferred_learning_style,
                   up.time_availability, up.current_level,
                   pref.theme, pref.language, pref.notifications_enabled, pref.daily_goal, pref.weekly_goal,
                   pref.auto_save, pref.difficulty_preference
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id
            LEFT JOIN user_preferences pref ON u.id = pref.user_id
            WHERE u.id = ?`, [req.user.id], (err, userData) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao carregar perfil' });
        }
        res.json(userData);
    });
});

app.put('/user/profile', authenticateToken, (req, res) => {
    const { full_name, age, nick, bio, profile_picture, interests, learning_goals, preferred_learning_style, teacher_user_id } = req.body;

    db.run(`UPDATE users SET nick = ?, bio = ?, profile_picture = ?, teacher_user_id = ? WHERE id = ?`,
        [nick || null, bio || null, profile_picture || null, teacher_user_id || null, req.user.id], (err) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao atualizar perfil' });
        }

        db.run(`UPDATE user_profiles SET full_name = ?, age = ?, interests = ?, learning_goals = ?, preferred_learning_style = ? WHERE user_id = ?`,
            [full_name, age, JSON.stringify(interests), JSON.stringify(learning_goals), preferred_learning_style, req.user.id], (err) => {
            if (err) {
                return res.status(500).json({ error: 'Erro ao atualizar perfil' });
            }

            res.json({ message: 'Perfil atualizado com sucesso' });
        });
    });
});

app.post('/themes/create', authenticateToken, upload.single('material'), async (req, res) => {
    const { theme_name, description } = req.body;

    if (!theme_name) {
        return res.status(400).json({ error: 'Nome do tema é obrigatório' });
    }

    try {
        const themeCode = generateRandomId();
        const themeId = generateRandomId();
        let materialFilePath = null;
        let materialTextContent = null;

        if (req.file) {
            materialFilePath = req.file.path;
            try {
                const pdfBuffer = fs.readFileSync(materialFilePath);
                const pdfData = await pdfParse(pdfBuffer);
                materialTextContent = pdfData.text;
            } catch (pdfError) {
                console.error('Erro ao processar PDF:', pdfError);
            }
        }

        db.run('INSERT INTO study_themes (theme_id, user_id, theme_name, description, theme_code, material_file_path, material_text_content) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [themeId, req.user.id, theme_name, description, themeCode, materialFilePath, materialTextContent], function(err) {
            if (err) {
                if (req.file && fs.existsSync(req.file.path)) {
                    fs.unlinkSync(req.file.path);
                }
                return res.status(500).json({ error: 'Erro ao criar tema' });
            }

            const dbThemeId = this.lastID;

            const studyContent = materialTextContent ? `${theme_name}\n\nMaterial Didático:\n${materialTextContent.substring(0, 5000)}` : theme_name;

            const aiPayload = {
                tipo: 'geração_de_plano_estudo',
                conteúdo_estudo: studyContent,
                nível_dificuldade: 'beginner',
                outras_informações: {
                    theme_id: dbThemeId,
                    user_id: req.user.id,
                    generate_tag: true,
                    has_material: !!materialTextContent
                }
            };

            callAIService(aiPayload).then(aiResponse => {
                if (aiResponse.error) {
                    console.error('Erro da IA:', aiResponse.error);
                    return res.status(500).json({ error: 'Erro na geração do plano de estudo: ' + aiResponse.error });
                }

                if (aiResponse.tópicos && Array.isArray(aiResponse.tópicos)) {
                    const topics = aiResponse.tópicos;
                    const tag = aiResponse.tag || `#${theme_name.toLowerCase().replace(/\s+/g, '-')}`;

                    db.run('UPDATE study_themes SET tag = ? WHERE id = ?', [tag, dbThemeId]);

                    const insertStmt = db.prepare(`
                        INSERT INTO learning_paths (topic_id, user_id, theme_id, topic_code, topic_name, topic_description, topic_order, difficulty)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `);

                    topics.forEach((topic, index) => {
                        const topicCode = generateRandomId();
                        const topicId = generateRandomId();
                        insertStmt.run([topicId, req.user.id, dbThemeId, topicCode, topic.nome, topic.descrição, index, topic.dificuldade || 'beginner']);
                    });

                    insertStmt.finalize();

                    db.run(`INSERT INTO forum_categories (name, description, tag) VALUES (?, ?, ?)`,
                        [theme_name, `Discussões sobre ${theme_name}`, tag], function(err) {
                        if (err) {
                            console.error('Erro ao criar categoria no fórum:', err);
                        }
                    });

                    res.json({
                        theme_id: dbThemeId,
                        theme_code: themeCode,
                        theme_id_display: themeId,
                        tag: tag,
                        topics: topics,
                        has_material: !!materialTextContent,
                        message: 'Tema e plano de estudo criados com sucesso'
                    });
                } else {
                    console.error('Resposta da IA inválida:', aiResponse);
                    res.status(500).json({ error: 'Resposta da IA inválida - estrutura de tópicos não encontrada' });
                }
            }).catch(error => {
                console.error('Erro na comunicação com IA:', error);
                res.status(500).json({ error: 'Erro na comunicação com IA: ' + error.message });
            });
        });
    } catch (error) {
        console.error('Erro ao criar tema:', error);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.get('/themes', authenticateToken, (req, res) => {
    db.all('SELECT *, theme_id as display_id FROM study_themes WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC',
        [req.user.id], (err, themes) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao carregar temas' });
        }
        res.json({ themes: themes || [] });
    });
});

app.get('/themes/ids', authenticateToken, (req, res) => {
    db.all('SELECT id, theme_id, theme_name, theme_code FROM study_themes WHERE user_id = ? AND is_active = 1 ORDER BY theme_name',
        [req.user.id], (err, themes) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao carregar IDs dos temas' });
        }
        res.json({ themes: themes || [] });
    });
});

app.delete('/themes/:themeId', authenticateToken, (req, res) => {
    const { themeId } = req.params;

    db.run('DELETE FROM study_themes WHERE id = ? AND user_id = ?', [themeId, req.user.id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Erro ao remover tema' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Tema não encontrado' });
        }
        res.json({ message: 'Tema removido com sucesso' });
    });
});

app.get('/themes/:themeId/progress', authenticateToken, async (req, res) => {
    const { themeId } = req.params;

    try {
        const topics = await getTopicProgress(req.user.id, themeId);
        const currentTopic = await getCurrentLearningTopic(req.user.id, themeId);

        if (currentTopic) {
            const quizAvailable = await canTakeQuiz(req.user.id, currentTopic.id);
            const examAvailable = await canTakeExam(req.user.id, currentTopic.id);

            currentTopic.quiz_available = quizAvailable;
            currentTopic.exam_available = examAvailable;
        }

        db.get('SELECT theme_id FROM study_themes WHERE id = ?', [themeId], (err, theme) => {
            res.json({
                theme_id: theme?.theme_id,
                topics: topics,
                current_topic: currentTopic
            });
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao carregar progresso' });
    }
});

app.get('/themes/:themeId/ids', authenticateToken, (req, res) => {
    const { themeId } = req.params;

    db.get('SELECT theme_id, theme_code FROM study_themes WHERE id = ? AND user_id = ?', [themeId, req.user.id], (err, theme) => {
        if (err || !theme) {
            return res.status(404).json({ error: 'Tema não encontrado' });
        }

        db.all('SELECT topic_id, topic_code, topic_name FROM learning_paths WHERE theme_id = ? AND user_id = ? ORDER BY topic_order',
            [themeId, req.user.id], (err, topics) => {
            if (err) {
                return res.status(500).json({ error: 'Erro ao carregar tópicos' });
            }

            res.json({
                theme: theme,
                topics: topics || []
            });
        });
    });
});

app.post('/study/generate-lesson', authenticateToken, rateLimitMiddleware('generate_lesson', 3 * 60 * 1000, 1), async (req, res) => {
    const { theme_id } = req.body;

    try {
        const currentTopic = await getCurrentLearningTopic(req.user.id, theme_id);

        if (!currentTopic) {
            return res.status(400).json({ error: 'Nenhum tópico ativo encontrado' });
        }

        db.get('SELECT material_text_content FROM study_themes WHERE id = ?', [theme_id], async (err, theme) => {
            if (err) {
                return res.status(500).json({ error: 'Erro ao carregar tema' });
            }

            let studyContent = `${currentTopic.theme_name} (Plano de Estudo) - ${currentTopic.topic_name} - ${currentTopic.topic_description}`;
            if (theme && theme.material_text_content) {
                studyContent = `${studyContent}\n\nMaterial Didático:\n${theme.material_text_content.substring(0, 5000)}`;
            }

            const aiPayload = {
                tipo: 'geração_de_lições',
                conteúdo_estudo: studyContent,
                nível_dificuldade: currentTopic.difficulty,
                outras_informações: {
                    theme_id: theme_id,
                    topic_id: currentTopic.id,
                    user_id: req.user.id,
                    has_material: !!(theme && theme.material_text_content)
                }
            };

            try {
                const aiResponse = await callAIService(aiPayload);

                if (aiResponse.error) {
                    return res.status(500).json({ error: 'Erro na geração da lição: ' + aiResponse.error });
                }

                const sessionId = generateUniqueId();

                db.run(`INSERT INTO study_sessions (user_id, theme_id, topic_id, session_id, session_type, content_data, status)
                        VALUES (?, ?, ?, ?, 'lesson', ?, 'completed')`,
                    [req.user.id, theme_id, currentTopic.id, sessionId, JSON.stringify(aiResponse)],
                    async function(err) {
                        if (err) {
                            return res.status(500).json({ error: 'Erro ao criar sessão de estudo' });
                        }

                        await updateTopicProgress(req.user.id, theme_id, currentTopic.id, {
                            progress: 10,
                            lessons_completed: currentTopic.lessons_completed + 1,
                            quizzes_completed: currentTopic.quizzes_completed,
                            exams_completed: currentTopic.exams_completed,
                            status: 'in_progress'
                        });

                        await createHelpSession(req.user.id, sessionId, null, 999);

                        res.json({
                            session_id: sessionId,
                            topic: currentTopic,
                            content: aiResponse,
                            message: 'Lições geradas com sucesso'
                        });
                    });
            } catch (error) {
                res.status(500).json({ error: 'Erro interno do servidor: ' + error.message });
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro interno do servidor: ' + error.message });
    }
});

app.post('/study/generate-quiz', authenticateToken, rateLimitMiddleware('generate_quiz', 3 * 60 * 1000, 1), async (req, res) => {
    const { theme_id } = req.body;

    try {
        const currentTopic = await getCurrentLearningTopic(req.user.id, theme_id);

        if (!currentTopic) {
            return res.status(400).json({ error: 'Nenhum tópico ativo encontrado' });
        }

        const quizAvailable = await canTakeQuiz(req.user.id, currentTopic.id);
        if (!quizAvailable) {
            return res.status(400).json({ error: 'Complete pelo menos uma lição antes de fazer um simulado' });
        }

        db.get('SELECT material_text_content FROM study_themes WHERE id = ?', [theme_id], async (err, theme) => {
            if (err) {
                return res.status(500).json({ error: 'Erro ao carregar tema' });
            }

            let studyContent = `${currentTopic.theme_name} (Plano de Estudo) - ${currentTopic.topic_name} - ${currentTopic.topic_description}`;
            if (theme && theme.material_text_content) {
                studyContent = `${studyContent}\n\nMaterial Didático:\n${theme.material_text_content.substring(0, 5000)}`;
            }

            const aiPayload = {
                tipo: 'questionamento',
                conteúdo_estudo: studyContent,
                nível_dificuldade: currentTopic.difficulty,
                outras_informações: {
                    theme_id: theme_id,
                    topic_id: currentTopic.id,
                    user_id: req.user.id,
                    question_count: 5,
                    has_material: !!(theme && theme.material_text_content)
                }
            };

            try {
                const aiResponse = await callAIService(aiPayload);

                if (aiResponse.error) {
                    return res.status(500).json({ error: 'Erro na geração do quiz: ' + aiResponse.error });
                }

                let questions = [];
                if (aiResponse.perguntas && Array.isArray(aiResponse.perguntas)) {
                    questions = aiResponse.perguntas;
                } else if (Array.isArray(aiResponse)) {
                    questions = aiResponse;
                } else {
                    return res.status(500).json({ error: 'Formato de resposta da IA inválido' });
                }

                const correctAnswers = questions.map(q => q.resposta_correta);
                const assessmentId = generateUniqueId();

                db.run(`INSERT INTO assessments (user_id, theme_id, topic_id, assessment_id, assessment_type, questions, correct_answers, total_questions)
                        VALUES (?, ?, ?, ?, 'quiz', ?, ?, ?)`,
                    [req.user.id, theme_id, currentTopic.id, assessmentId, JSON.stringify(questions), JSON.stringify(correctAnswers), questions.length],
                    async function(err) {
                        if (err) {
                            return res.status(500).json({ error: 'Erro ao criar quiz' });
                        }

                        await createHelpSession(req.user.id, null, assessmentId, 2);

                        const questionsForClient = questions.map(q => ({
                            pergunta: q.pergunta,
                            opções: q.opções
                        }));

                        res.json({
                            assessment_id: assessmentId,
                            topic: currentTopic,
                            questions: questionsForClient,
                            assessment_type: 'quiz',
                            message: 'Quiz gerado com sucesso'
                        });
                    });
            } catch (error) {
                res.status(500).json({ error: 'Erro interno do servidor: ' + error.message });
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro interno do servidor: ' + error.message });
    }
});

app.post('/study/generate-exam', authenticateToken, rateLimitMiddleware('generate_exam', 3 * 60 * 1000, 1), async (req, res) => {
    const { theme_id } = req.body;

    try {
        const currentTopic = await getCurrentLearningTopic(req.user.id, theme_id);

        if (!currentTopic) {
            return res.status(400).json({ error: 'Nenhum tópico ativo encontrado' });
        }

        const examAvailable = await canTakeExam(req.user.id, currentTopic.id);
        if (!examAvailable) {
            return res.status(400).json({ error: 'Complete pelo menos 3 simulados com nota mínima de 50% antes de fazer a prova' });
        }

        db.get('SELECT material_text_content FROM study_themes WHERE id = ?', [theme_id], async (err, theme) => {
            if (err) {
                return res.status(500).json({ error: 'Erro ao carregar tema' });
            }

            let studyContent = `${currentTopic.theme_name} (Plano de Estudo) - ${currentTopic.topic_name} - ${currentTopic.topic_description}`;
            if (theme && theme.material_text_content) {
                studyContent = `${studyContent}\n\nMaterial Didático:\n${theme.material_text_content.substring(0, 5000)}`;
            }

            const aiPayload = {
                tipo: 'provas',
                conteúdo_estudo: studyContent,
                nível_dificuldade: currentTopic.difficulty,
                outras_informações: {
                    theme_id: theme_id,
                    topic_id: currentTopic.id,
                    user_id: req.user.id,
                    question_count: 10,
                    has_material: !!(theme && theme.material_text_content)
                }
            };

            try {
                const aiResponse = await callAIService(aiPayload);

                if (aiResponse.error) {
                    return res.status(500).json({ error: 'Erro na geração do exame: ' + aiResponse.error });
                }

                let questions = [];
                if (aiResponse.perguntas && Array.isArray(aiResponse.perguntas)) {
                    questions = aiResponse.perguntas;
                } else if (Array.isArray(aiResponse)) {
                    questions = aiResponse;
                } else {
                    return res.status(500).json({ error: 'Formato de resposta da IA inválido' });
                }

                const correctAnswers = questions.map(q => q.resposta_correta);
                const assessmentId = generateUniqueId();

                db.run(`INSERT INTO assessments (user_id, theme_id, topic_id, assessment_id, assessment_type, questions, correct_answers, total_questions)
                        VALUES (?, ?, ?, ?, 'exam', ?, ?, ?)`,
                    [req.user.id, theme_id, currentTopic.id, assessmentId, JSON.stringify(questions), JSON.stringify(correctAnswers), questions.length],
                    function(err) {
                        if (err) {
                            return res.status(500).json({ error: 'Erro ao criar exame' });
                        }

                        const questionsForClient = questions.map(q => ({
                            pergunta: q.pergunta,
                            opções: q.opções
                        }));

                        res.json({
                            assessment_id: assessmentId,
                            topic: currentTopic,
                            questions: questionsForClient,
                            assessment_type: 'exam',
                            message: 'Exame gerado com sucesso'
                        });
                    });
            } catch (error) {
                res.status(500).json({ error: 'Erro interno do servidor: ' + error.message });
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro interno do servidor: ' + error.message });
    }
});

app.post('/assessment/submit', authenticateToken, async (req, res) => {
    const { assessment_id, answers, time_spent } = req.body;

    if (!assessment_id) {
        return res.status(400).json({ error: 'ID da avaliação é obrigatório' });
    }

    if (!Array.isArray(answers)) {
        return res.status(400).json({ error: 'Respostas devem ser um array' });
    }

    db.get(
      `SELECT * FROM assessments WHERE assessment_id = ? AND user_id = ?`,
      [assessment_id, req.user.id],
      async (err, assessment) => {

        if (err || !assessment) {
            return res.status(404).json({ error: 'Avaliação não encontrada' });
        }

        let questions;
        let correctAnswers;

        try {
            questions = typeof assessment.questions === 'string' ? JSON.parse(assessment.questions) : assessment.questions;
            correctAnswers = typeof assessment.correct_answers === 'string' ? JSON.parse(assessment.correct_answers) : assessment.correct_answers;

            if (!Array.isArray(questions)) {
                if (questions.perguntas && Array.isArray(questions.perguntas)) {
                    questions = questions.perguntas;
                } else if (questions.questions && Array.isArray(questions.questions)) {
                    questions = questions.questions;
                } else {
                    questions = [];
                }
            }

            if (!Array.isArray(correctAnswers)) {
                correctAnswers = [];
            }
        } catch (parseError) {
            console.error('Erro ao fazer parse das questões:', parseError);
            return res.status(500).json({ error: 'Erro no formato das questões da avaliação' });
        }

        let correctCount = 0;

        for (let i = 0; i < questions.length; i++) {
            const question = questions[i];
            const userAnswer = answers[i];
            const correctAnswer = correctAnswers[i];

            const userAnswerLetter = extractCorrectAnswerLetter(userAnswer, question.opções);
            const correctAnswerLetter = extractCorrectAnswerLetter(correctAnswer, question.opções);

            if (userAnswerLetter && correctAnswerLetter && userAnswerLetter === correctAnswerLetter) {
                correctCount++;
            } else {
                db.run(`INSERT INTO error_logs (user_id, theme_id, topic_id, assessment_id, error_type, error_description, correct_answer, user_answer)
                        VALUES (?, ?, ?, ?, 'assessment_error', ?, ?, ?)`,
                    [req.user.id, assessment.theme_id, assessment.topic_id, assessment_id,
                     `Resposta incorreta na questão ${i + 1}`, correctAnswer, userAnswer]);
            }
        }

        const score = (correctCount / questions.length) * 100;
        const passed = assessment.assessment_type === 'quiz' ? score >= 50 : score >= 70;

        db.run(`UPDATE assessments
                SET user_answers = ?, score = ?, correct_count = ?, time_spent = ?,
                    completed_at = CURRENT_TIMESTAMP, status = 'completed'
                WHERE assessment_id = ?`,
            [JSON.stringify(answers), score, correctCount, time_spent, assessment_id],
            async function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Erro ao salvar avaliação' });
                }

                updateUserProgress(req.user.id, assessment.theme_id, assessment.topic_id, score, 'assessment_score');

                const currentTopic = await getCurrentLearningTopic(req.user.id, assessment.theme_id);
                let newProgress = currentTopic ? currentTopic.progress : 0;
                let newQuizzesCompleted = currentTopic ? currentTopic.quizzes_completed : 0;
                let newExamsCompleted = currentTopic ? currentTopic.exams_completed : 0;
                let newStatus = currentTopic ? currentTopic.status : 'pending';

                if (assessment.assessment_type === 'quiz' && passed) {
                    newQuizzesCompleted = (currentTopic ? currentTopic.quizzes_completed : 0) + 1;
                    newProgress = 10 + Math.min(30, (newQuizzesCompleted * 10));
                } else if (assessment.assessment_type === 'exam' && passed) {
                    newExamsCompleted = 1;
                    newProgress = 100;
                    newStatus = 'completed';

                    db.run(`INSERT INTO achievements (user_id, achievement_type, achievement_name, achievement_description, points)
                            VALUES (?, 'topic_completed', 'Tópico Concluído', 'Completou um tópico com sucesso', 100)`,
                        [req.user.id]);

                    const certificateCode = generateCertificateCode();
                    db.get(`SELECT up.full_name, st.theme_name, st.tag, st.theme_id as display_theme_id
                            FROM user_profiles up
                            JOIN study_themes st ON st.id = ?
                            WHERE up.user_id = ?`, [assessment.theme_id, req.user.id], (err, result) => {
                        if (result) {
                            const pdfHash = generateCertificateHash({
                                certificate_code: certificateCode,
                                full_name: result.full_name,
                                theme_name: result.theme_name,
                                tag: result.tag,
                                issue_date: new Date().toISOString()
                            });

                            db.run(`INSERT INTO certificates (user_id, theme_id, certificate_code, full_name, theme_name, tag, pdf_hash)
                                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                                [req.user.id, assessment.theme_id, certificateCode, result.full_name, result.theme_name, result.tag, pdfHash]);
                        }
                    });
                }

                if (currentTopic) {
                    await updateTopicProgress(req.user.id, assessment.theme_id, assessment.topic_id, {
                        progress: newProgress,
                        lessons_completed: currentTopic.lessons_completed,
                        quizzes_completed: newQuizzesCompleted,
                        exams_completed: newExamsCompleted,
                        status: newStatus
                    });
                }

                const analysis = await analyzeAssessmentResults(
                    req.user.id,
                    assessment.theme_id,
                    assessment.topic_id,
                    assessment_id,
                    JSON.stringify(questions),
                    JSON.stringify(answers),
                    JSON.stringify(correctAnswers)
                );

                res.json({
                    score: score,
                    correct_count: correctCount,
                    total_questions: questions.length,
                    passed: passed,
                    progress: newProgress,
                    assessment_type: assessment.assessment_type,
                    analysis: analysis,
                    message: 'Avaliação submetida com sucesso'
                });
            });
    });
});

app.post('/study/help', authenticateToken, rateLimitMiddleware('help', 30 * 1000, 1), async (req, res) => {
    const { session_id, assessment_id, message } = req.body;

    try {
        let helpSession = await getHelpSession(req.user.id, session_id, assessment_id);

        if (!helpSession) {
            if (assessment_id) {
                helpSession = await createHelpSession(req.user.id, null, assessment_id, 2);
            } else if (session_id) {
                helpSession = await createHelpSession(req.user.id, session_id, null, 999);
            }
        }

        if (!helpSession) {
            return res.status(500).json({ error: 'Erro ao criar sessão de ajuda' });
        }

        if (assessment_id && helpSession.help_count >= helpSession.max_help_count) {
            return res.status(400).json({ error: 'Você já usou todas as suas ajudas para esta sessão' });
        }

        let contextData = {};

        if (session_id) {
            db.get(`SELECT ss.*, st.theme_name, lp.topic_name, lp.topic_description
                    FROM study_sessions ss
                    JOIN study_themes st ON ss.theme_id = st.id
                    JOIN learning_paths lp ON ss.topic_id = lp.id
                    WHERE ss.session_id = ? AND ss.user_id = ?`,
                [session_id, req.user.id], (err, session) => {
                if (session) {
                    try {
                        const content = typeof session.content_data === 'string' ? JSON.parse(session.content_data) : session.content_data;
                        contextData = {
                            tipo_sessao: 'lição',
                            tema: session.theme_name,
                            tópico: session.topic_name,
                            descrição_tópico: session.topic_description,
                            conteúdo: content
                        };
                    } catch (e) {
                        contextData = {
                            tipo_sessao: 'lição',
                            tema: session.theme_name,
                            tópico: session.topic_name,
                            descrição_tópico: session.topic_description,
                            conteúdo: {}
                        };
                    }
                }
            });
        } else if (assessment_id) {
            db.get(`SELECT a.*, st.theme_name, lp.topic_name, lp.topic_description
                    FROM assessments a
                    JOIN study_themes st ON a.theme_id = st.id
                    JOIN learning_paths lp ON a.topic_id = lp.id
                    WHERE a.assessment_id = ? AND a.user_id = ?`,
                [assessment_id, req.user.id], (err, assessment) => {
                if (assessment) {
                    try {
                        let questions = typeof assessment.questions === 'string' ? JSON.parse(assessment.questions) : assessment.questions;
                        if (!Array.isArray(questions)) {
                            if (questions.perguntas) questions = questions.perguntas;
                            else if (questions.questions) questions = questions.questions;
                            else questions = [];
                        }

                        let userAnswers = assessment.user_answers ? (typeof assessment.user_answers === 'string' ? JSON.parse(assessment.user_answers) : assessment.user_answers) : [];
                        if (!Array.isArray(userAnswers)) userAnswers = [];

                        contextData = {
                            tipo_sessao: assessment.assessment_type === 'quiz' ? 'simulado' : 'prova',
                            tema: assessment.theme_name,
                            tópico: assessment.topic_name,
                            descrição_tópico: assessment.topic_description,
                            questões: questions,
                            respostas_usuario: userAnswers
                        };
                    } catch (e) {
                        contextData = {
                            tipo_sessao: assessment.assessment_type === 'quiz' ? 'simulado' : 'prova',
                            tema: assessment.theme_name,
                            tópico: assessment.topic_name,
                            descrição_tópico: assessment.topic_description,
                            questões: [],
                            respostas_usuario: []
                        };
                    }
                }
            });
        }

        const aiPayload = {
            tipo: 'ajuda',
            conteúdo_estudo: message,
            outras_informações: {
                contexto: contextData,
                user_id: req.user.id,
                ajuda_restante: helpSession.max_help_count - helpSession.help_count
            }
        };

        const aiResponse = await callAIService(aiPayload);

        if (aiResponse.error) {
            return res.status(500).json({ error: 'Erro na geração da ajuda: ' + aiResponse.error });
        }

        await incrementHelpCount(helpSession.id);

        res.json({
            resposta: aiResponse.resposta || aiResponse,
            ajuda_restante: helpSession.max_help_count - (helpSession.help_count + 1),
            tipo: aiResponse.tipo || 'resposta'
        });

    } catch (error) {
        res.status(500).json({ error: 'Erro interno do servidor: ' + error.message });
    }
});

app.get('/study/history', authenticateToken, (req, res) => {
    const { theme_id, limit } = req.query;

    let query = `
        SELECT ss.*, st.theme_name, lp.topic_name
        FROM study_sessions ss
        JOIN study_themes st ON ss.theme_id = st.id
        JOIN learning_paths lp ON ss.topic_id = lp.id
        WHERE ss.user_id = ?
    `;

    let params = [req.user.id];

    if (theme_id) {
        query += ' AND ss.theme_id = ?';
        params.push(theme_id);
    }

    query += ' ORDER BY ss.created_at DESC';

    if (limit) {
        query += ' LIMIT ?';
        params.push(parseInt(limit));
    } else {
        query += ' LIMIT 50';
    }

    db.all(query, params, (err, sessions) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao carregar histórico' });
        }

        res.json({ sessions: sessions || [] });
    });
});

app.get('/assessment/history', authenticateToken, (req, res) => {
    const { theme_id, limit } = req.query;

    let query = `
        SELECT a.*, st.theme_name, lp.topic_name
        FROM assessments a
        JOIN study_themes st ON a.theme_id = st.id
        JOIN learning_paths lp ON a.topic_id = lp.id
        WHERE a.user_id = ? AND a.status = 'completed' AND a.is_annulled = 0
    `;

    let params = [req.user.id];

    if (theme_id) {
        query += ' AND a.theme_id = ?';
        params.push(theme_id);
    }

    query += ' ORDER BY a.completed_at DESC';

    if (limit) {
        query += ' LIMIT ?';
        params.push(parseInt(limit));
    } else {
        query += ' LIMIT 50';
    }

    db.all(query, params, (err, assessments) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao carregar histórico' });
        }

        res.json({ assessments: assessments || [] });
    });
});

app.get('/assessment/:assessmentId', authenticateToken, (req, res) => {
    const { assessmentId } = req.params;

    db.get(`SELECT a.*, st.theme_name, lp.topic_name
            FROM assessments a
            JOIN study_themes st ON a.theme_id = st.id
            JOIN learning_paths lp ON a.topic_id = lp.id
            WHERE a.assessment_id = ? AND a.user_id = ?`,
        [assessmentId, req.user.id], (err, assessment) => {
        if (err || !assessment) {
            return res.status(404).json({ error: 'Avaliação não encontrada' });
        }

        let questions;
        let userAnswers;
        let correctAnswers;

        try {
            questions = typeof assessment.questions === 'string' ? JSON.parse(assessment.questions) : assessment.questions;
            userAnswers = assessment.user_answers ? (typeof assessment.user_answers === 'string' ? JSON.parse(assessment.user_answers) : assessment.user_answers) : [];
            correctAnswers = typeof assessment.correct_answers === 'string' ? JSON.parse(assessment.correct_answers) : assessment.correct_answers;

            if (!Array.isArray(questions)) {
                if (questions.perguntas && Array.isArray(questions.perguntas)) {
                    questions = questions.perguntas;
                } else if (questions.questions && Array.isArray(questions.questions)) {
                    questions = questions.questions;
                } else {
                    questions = [];
                }
            }

            if (!Array.isArray(userAnswers)) {
                userAnswers = [];
            }

            if (!Array.isArray(correctAnswers)) {
                correctAnswers = [];
            }
        } catch (parseError) {
            console.error('Erro ao fazer parse dos dados da avaliação:', parseError);
            questions = [];
            userAnswers = [];
            correctAnswers = [];
        }

        const questionsWithAnalysis = questions.map((q, index) => ({
            pergunta: q.pergunta || q.question || `Questão ${index + 1}`,
            opções: q.opções || q.options || [],
            resposta_usuario: userAnswers[index] || null,
            resposta_correta: correctAnswers[index],
            correta: userAnswers[index] === correctAnswers[index]
        }));

        let analysisData = null;
        if (assessment.analysis_data) {
            try {
                analysisData = typeof assessment.analysis_data === 'string' ? JSON.parse(assessment.analysis_data) : assessment.analysis_data;
            } catch (e) {
                analysisData = null;
            }
        }

        res.json({
            assessment_id: assessment.assessment_id,
            assessment_type: assessment.assessment_type,
            theme_name: assessment.theme_name,
            topic_name: assessment.topic_name,
            score: assessment.score,
            total_questions: assessment.total_questions,
            correct_count: assessment.correct_count,
            time_spent: assessment.time_spent,
            completed_at: assessment.completed_at,
            questions: questionsWithAnalysis,
            analysis_data: analysisData
        });
    });
});

app.post('/assessment/:assessmentId/annul-question', authenticateToken, requireRole(['teacher', 'admin']), (req, res) => {
    const { assessmentId } = req.params;
    const { question_index } = req.body;

    if (question_index === undefined || question_index === null) {
        return res.status(400).json({ error: 'Índice da questão é obrigatório' });
    }

    db.get('SELECT * FROM assessments WHERE assessment_id = ?', [assessmentId], (err, assessment) => {
        if (err || !assessment) {
            return res.status(404).json({ error: 'Avaliação não encontrada' });
        }

        db.run(`INSERT INTO assessment_questions (assessment_id, question_index, is_annulled)
                VALUES (?, ?, 1)`,
            [assessmentId, question_index], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Erro ao anular questão' });
            }

            const newTotalQuestions = assessment.total_questions - 1;
            const newScore = newTotalQuestions > 0 ? (assessment.correct_count / newTotalQuestions) * 100 : 0;

            db.run(`UPDATE assessments
                    SET total_questions = ?, score = ?
                    WHERE assessment_id = ?`,
                [newTotalQuestions, newScore, assessmentId], () => {
                res.json({ message: 'Questão anulada com sucesso', new_score: newScore });
            });
        });
    });
});

app.post('/assessment/:assessmentId/validate-question', authenticateToken, requireRole(['teacher', 'admin']), (req, res) => {
    const { assessmentId } = req.params;
    const { question_index } = req.body;

    if (question_index === undefined || question_index === null) {
        return res.status(400).json({ error: 'Índice da questão é obrigatório' });
    }

    db.run(`INSERT INTO assessment_questions (assessment_id, question_index, validated)
            VALUES (?, ?, 1)`,
        [assessmentId, question_index], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Erro ao validar questão' });
        }

        res.json({ message: 'Questão validada com sucesso' });
    });
});

app.post('/assessment/:assessmentId/annul', authenticateToken, requireRole(['teacher', 'admin']), (req, res) => {
    const { assessmentId } = req.params;

    db.run(`UPDATE assessments SET is_annulled = 1 WHERE assessment_id = ?`,
        [assessmentId], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Erro ao anular avaliação' });
        }

        res.json({ message: 'Avaliação anulada com sucesso' });
    });
});

app.get('/dashboard/stats', authenticateToken, (req, res) => {
    db.serialize(() => {
        db.get(`SELECT COUNT(*) as total_sessions,
                       SUM(time_spent) as total_study_time,
                       AVG(score) as avg_session_score
                FROM study_sessions
                WHERE user_id = ? AND status = 'completed'`,
            [req.user.id], (err, sessionStats) => {

            db.get(`SELECT COUNT(*) as total_assessments,
                           AVG(score) as avg_assessment_score,
                           MAX(score) as best_score
                    FROM assessments
                    WHERE user_id = ? AND status = 'completed' AND is_annulled = 0`,
                [req.user.id], (err, assessmentStats) => {

                db.get(`SELECT COUNT(*) as total_errors
                        FROM error_logs
                        WHERE user_id = ? AND resolved = 0`,
                    [req.user.id], (err, errorStats) => {

                    db.get(`SELECT COUNT(*) as total_achievements,
                                   SUM(points) as total_points
                            FROM achievements
                            WHERE user_id = ?`,
                        [req.user.id], (err, achievementStats) => {

                        db.get(`SELECT current_level FROM user_profiles WHERE user_id = ?`,
                            [req.user.id], (err, levelData) => {

                            db.get(`SELECT COUNT(*) as completed_topics
                                    FROM learning_paths
                                    WHERE user_id = ? AND status = 'completed'`,
                                [req.user.id], (err, topicStats) => {

                                db.get(`SELECT COUNT(*) as total_certificates
                                        FROM certificates
                                        WHERE user_id = ?`,
                                    [req.user.id], (err, certificateStats) => {

                                    res.json({
                                        session_stats: sessionStats || {},
                                        assessment_stats: assessmentStats || {},
                                        error_stats: errorStats || {},
                                        achievement_stats: achievementStats || {},
                                        topic_stats: topicStats || {},
                                        certificate_stats: certificateStats || {},
                                        current_level: levelData?.current_level || 'beginner'
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});

app.get('/certificates', authenticateToken, (req, res) => {
    db.all(`SELECT c.*, st.theme_name, st.tag, st.theme_id as display_theme_id
            FROM certificates c
            JOIN study_themes st ON c.theme_id = st.id
            WHERE c.user_id = ?
            ORDER BY c.issue_date DESC`,
        [req.user.id], (err, certificates) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao carregar certificados' });
        }
        res.json({ certificates: certificates || [] });
    });
});

app.get('/certificates/download/:code', (req, res) => {
    const { code } = req.params;

    db.get(`SELECT c.*, st.theme_name, st.tag
            FROM certificates c
            JOIN study_themes st ON c.theme_id = st.id
            WHERE c.certificate_code = ?`,
        [code], (err, certificate) => {
        if (err || !certificate) {
            return res.status(404).json({ error: 'Certificado não encontrado' });
        }

        generateCertificatePDF(certificate, res);
    });
});

app.get('/certificates/download-report/:code', (req, res) => {
    const { code } = req.params;

    db.get(`SELECT c.*, st.id as theme_id, st.theme_name, st.tag, st.description
            FROM certificates c
            JOIN study_themes st ON c.theme_id = st.id
            WHERE c.certificate_code = ?`,
        [code], (err, certificate) => {
        if (err || !certificate) {
            return res.status(404).json({ error: 'Certificado não encontrado' });
        }

        db.get(`SELECT up.* FROM user_profiles up JOIN users u ON up.user_id = u.id WHERE u.id = ?`, [certificate.user_id], (err, profile) => {
            db.all(`SELECT a.*, st.theme_name, lp.topic_name
                    FROM assessments a
                    JOIN study_themes st ON a.theme_id = st.id
                    JOIN learning_paths lp ON a.topic_id = lp.id
                    WHERE a.theme_id = ? AND a.user_id = ? AND a.status = 'completed' AND a.is_annulled = 0
                    ORDER BY a.completed_at DESC`,
                [certificate.theme_id, certificate.user_id], (err, assessments) => {

                db.all(`SELECT ss.*, st.theme_name, lp.topic_name
                        FROM study_sessions ss
                        JOIN study_themes st ON ss.theme_id = st.id
                        JOIN learning_paths lp ON ss.topic_id = lp.id
                        WHERE ss.theme_id = ? AND ss.user_id = ?
                        ORDER BY ss.created_at DESC`,
                    [certificate.theme_id, certificate.user_id], (err, sessions) => {

                    generateReportPDF(certificate, assessments || [], sessions || [], profile || {}, res);
                });
            });
        });
    });
});

app.get('/certificates/verify/:code', (req, res) => {
    const { code } = req.params;

    db.get(`SELECT c.*, st.theme_name, st.tag
            FROM certificates c
            JOIN study_themes st ON c.theme_id = st.id
            WHERE c.certificate_code = ?`,
        [code], (err, certificate) => {
        if (err || !certificate) {
            return res.status(404).json({ error: 'Certificado não encontrado' });
        }
        res.json({
            valid: true,
            certificate: certificate
        });
    });
});

app.get('/certificates/search', authenticateToken, requireRole(['teacher', 'admin']), (req, res) => {
    const { user_id, theme_id, certificate_code, start_date, end_date } = req.query;

    let query = `
        SELECT c.*, st.theme_name, st.tag, st.theme_id as display_theme_id
        FROM certificates c
        JOIN study_themes st ON c.theme_id = st.id
        WHERE 1=1
    `;

    let params = [];

    if (user_id) {
        query += ' AND c.user_id = (SELECT id FROM users WHERE user_id = ?)';
        params.push(user_id);
    }

    if (theme_id) {
        query += ' AND st.theme_id = ?';
        params.push(theme_id);
    }

    if (certificate_code) {
        query += ' AND c.certificate_code = ?';
        params.push(certificate_code);
    }

    if (start_date) {
        query += ' AND DATE(c.issue_date) >= DATE(?)';
        params.push(start_date);
    }

    if (end_date) {
        query += ' AND DATE(c.issue_date) <= DATE(?)';
        params.push(end_date);
    }

    query += ' ORDER BY c.issue_date DESC';

    db.all(query, params, (err, certificates) => {
        if (err) {
            return res.status(500).json({ error: 'Erro na busca de certificados' });
        }
        res.json({ certificates: certificates || [] });
    });
});

app.get('/forum/categories', authenticateToken, (req, res) => {
    db.all(`SELECT fc.*,
                   (SELECT COUNT(*) FROM forum_posts WHERE category_id = fc.id) as post_count,
                   (SELECT COUNT(*) FROM forum_replies fr JOIN forum_posts fp ON fr.post_id = fp.id WHERE fp.category_id = fc.id) as reply_count
            FROM forum_categories fc
            ORDER BY fc.name`,
        (err, categories) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao carregar categorias' });
        }
        res.json({ categories: categories || [] });
    });
});

app.get('/forum/posts/:categoryId', authenticateToken, (req, res) => {
    const { categoryId } = req.params;

    db.all(`SELECT fp.*, u.username, u.user_id, up.full_name, u.role, u.user_code, u.profile_picture, u.nick,
                   (SELECT COUNT(*) FROM forum_replies WHERE post_id = fp.id) as reply_count
            FROM forum_posts fp
            JOIN users u ON fp.user_id = u.id
            LEFT JOIN user_profiles up ON u.id = up.user_id
            WHERE fp.category_id = ?
            ORDER BY fp.is_pinned DESC, fp.last_activity DESC`,
        [categoryId], (err, posts) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao carregar posts' });
        }
        res.json({ posts: posts || [] });
    });
});

app.get('/forum/post/:postId', authenticateToken, (req, res) => {
    const { postId } = req.params;

    db.serialize(() => {
        db.get(`SELECT fp.*, u.username, u.user_id, up.full_name, u.role, u.user_code, u.profile_picture, u.nick
                FROM forum_posts fp
                JOIN users u ON fp.user_id = u.id
                LEFT JOIN user_profiles up ON u.id = up.user_id
                WHERE fp.id = ?`,
            [postId], (err, post) => {
            if (err || !post) {
                return res.status(404).json({ error: 'Post não encontrado' });
            }

            db.run('UPDATE forum_posts SET view_count = view_count + 1 WHERE id = ?', [postId]);

            db.all(`SELECT fr.*, u.username, u.user_id, up.full_name, u.role, u.user_code, u.profile_picture, u.nick
                    FROM forum_replies fr
                    JOIN users u ON fr.user_id = u.id
                    LEFT JOIN user_profiles up ON u.id = up.user_id
                    WHERE fr.post_id = ? AND fr.is_removed = 0
                    ORDER BY fr.created_at ASC`,
                [postId], (err, replies) => {
                if (err) {
                    return res.status(500).json({ error: 'Erro ao carregar respostas' });
                }
                res.json({ post: post, replies: replies || [] });
            });
        });
    });
});

app.post('/forum/posts', authenticateToken, (req, res) => {
    const { category_id, title, content } = req.body;

    if (!category_id || !title || !content) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }

    db.run(`INSERT INTO forum_posts (category_id, user_id, title, content)
            VALUES (?, ?, ?, ?)`,
        [category_id, req.user.id, title, content], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Erro ao criar post' });
        }
        res.json({ message: 'Post criado com sucesso', post_id: this.lastID });
    });
});

app.post('/forum/replies', authenticateToken, (req, res) => {
    const { post_id, content } = req.body;

    if (!post_id || !content) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }

    db.serialize(() => {
        db.run(`INSERT INTO forum_replies (post_id, user_id, content)
                VALUES (?, ?, ?)`,
            [post_id, req.user.id, content], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Erro ao criar resposta' });
            }

            db.run(`UPDATE forum_posts
                    SET reply_count = reply_count + 1, last_activity = CURRENT_TIMESTAMP
                    WHERE id = ?`,
                [post_id]);

            res.json({ message: 'Resposta criada com sucesso', reply_id: this.lastID });
        });
    });
});

app.put('/forum/replies/:replyId/grade', authenticateToken, requireRole(['teacher', 'admin']), (req, res) => {
    const { replyId } = req.params;
    const { grade } = req.body;

    if (grade === undefined || grade < 0 || grade > 10) {
        return res.status(400).json({ error: 'Nota deve ser entre 0 e 10' });
    }

    db.serialize(() => {
        db.run('UPDATE forum_replies SET grade = ? WHERE id = ?', [grade, replyId], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Erro ao atribuir nota' });
            }

            db.run(`INSERT INTO forum_moderation (reply_id, moderator_id, action_type, grade_value)
                    VALUES (?, ?, 'grade', ?)`,
                [replyId, req.user.id, grade]);

            res.json({ message: 'Nota atribuída com sucesso' });
        });
    });
});

app.delete('/forum/replies/:replyId', authenticateToken, requireRole(['teacher', 'admin']), (req, res) => {
    const { replyId } = req.params;

    db.serialize(() => {
        db.get('SELECT content FROM forum_replies WHERE id = ?', [replyId], (err, reply) => {
            if (err || !reply) {
                return res.status(404).json({ error: 'Resposta não encontrada' });
            }

            db.run('UPDATE forum_replies SET is_removed = 1 WHERE id = ?', [replyId], function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Erro ao remover resposta' });
                }

                db.run(`INSERT INTO forum_moderation (reply_id, moderator_id, action_type, previous_content)
                        VALUES (?, ?, 'remove', ?)`,
                    [replyId, req.user.id, reply.content]);

                res.json({ message: 'Resposta removida com sucesso' });
            });
        });
    });
});

app.put('/forum/replies/:replyId', authenticateToken, requireRole(['teacher', 'admin']), (req, res) => {
    const { replyId } = req.params;
    const { content } = req.body;

    if (!content) {
        return res.status(400).json({ error: 'Conteúdo é obrigatório' });
    }

    db.serialize(() => {
        db.get('SELECT content FROM forum_replies WHERE id = ?', [replyId], (err, reply) => {
            if (err || !reply) {
                return res.status(404).json({ error: 'Resposta não encontrado' });
            }

            db.run('UPDATE forum_replies SET content = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ?',
                [content, replyId], function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Erro ao editar resposta' });
                }

                db.run(`INSERT INTO forum_moderation (reply_id, moderator_id, action_type, previous_content)
                        VALUES (?, ?, 'edit', ?)`,
                    [replyId, req.user.id, reply.content]);

                res.json({ message: 'Resposta editada com sucesso' });
            });
        });
    });
});

app.get('/user/profile-public/:userId', (req, res) => {
    const { userId } = req.params;

    db.get(`SELECT u.user_id, u.username, u.nick, u.profile_picture, u.bio, u.role,
                   up.full_name, up.current_level
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id
            WHERE u.user_id = ?`,
        [userId], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        res.json(user);
    });
});

app.get('/teacher/students', authenticateToken, requireRole(['teacher', 'admin']), (req, res) => {
    let query = '';
    let params = [];

    if (req.user.role === 'admin') {
        query = `
            SELECT u.id, u.user_id, u.username, u.email, u.created_at, u.user_code, u.profile_picture, u.nick,
                   up.full_name, up.current_level,
                   (SELECT AVG(score) FROM assessments WHERE user_id = u.id AND status = 'completed' AND is_annulled = 0) as avg_score,
                   (SELECT COUNT(*) FROM learning_paths WHERE user_id = u.id AND status = 'completed') as completed_topics
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id
            WHERE u.role = 'student'
            ORDER BY u.created_at DESC
        `;
    } else {
        query = `
            SELECT u.id, u.user_id, u.username, u.email, u.created_at, u.user_code, u.profile_picture, u.nick,
                   up.full_name, up.current_level,
                   (SELECT AVG(score) FROM assessments WHERE user_id = u.id AND status = 'completed' AND is_annulled = 0) as avg_score,
                   (SELECT COUNT(*) FROM learning_paths WHERE user_id = u.id AND status = 'completed') as completed_topics
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id
            WHERE u.role = 'student' AND u.teacher_user_id = ?
            ORDER BY u.created_at DESC
        `;
        params.push(req.user.user_id);
    }

    db.all(query, params, (err, students) => {
        if (err) {
            console.error('Erro ao carregar alunos:', err);
            return res.status(500).json({ error: 'Erro ao carregar alunos' });
        }
        res.json({ students: students || [] });
    });
});

app.get('/teacher/student/:studentId/interface', authenticateToken, requireRole(['teacher', 'admin']), async (req, res) => {
    const { studentId } = req.params;

    let studentQuery = '';
    let studentParams = [];

    if (req.user.role === 'admin') {
        studentQuery = `
            SELECT u.*, up.full_name, up.current_level
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id
            WHERE u.user_id = ?
        `;
        studentParams = [studentId];
    } else {
        studentQuery = `
            SELECT u.*, up.full_name, up.current_level
            FROM users u
            LEFT JOIN user_profiles up ON u.id = up.user_id
            WHERE u.user_id = ? AND u.teacher_user_id = ?
        `;
        studentParams = [studentId, req.user.user_id];
    }

    db.get(studentQuery, studentParams, async (err, student) => {
        if (err || !student) {
            return res.status(404).json({ error: 'Aluno não encontrado ou não autorizado' });
        }

        try {
            const [themes, progress, assessments, sessions] = await Promise.all([
                new Promise((resolve, reject) => {
                    db.all('SELECT *, theme_id as display_id FROM study_themes WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC',
                        [student.id], (err, themes) => {
                        if (err) reject(err);
                        else resolve(themes || []);
                    });
                }),
                new Promise((resolve, reject) => {
                    db.all(`
                        SELECT st.id as theme_id, st.theme_name, st.theme_id as display_theme_id, lp.*, lp.topic_id as display_topic_id
                        FROM study_themes st
                        LEFT JOIN learning_paths lp ON st.id = lp.theme_id
                        WHERE st.user_id = ?
                        ORDER BY st.created_at DESC, lp.topic_order ASC
                    `, [student.id], (err, topics) => {
                        if (err) reject(err);
                        else resolve(topics || []);
                    });
                }),
                new Promise((resolve, reject) => {
                    db.all(`
                        SELECT a.*, st.theme_name, lp.topic_name, st.theme_id as display_theme_id
                        FROM assessments a
                        JOIN study_themes st ON a.theme_id = st.id
                        JOIN learning_paths lp ON a.topic_id = lp.id
                        WHERE a.user_id = ? AND a.status = 'completed' AND a.is_annulled = 0
                        ORDER BY a.completed_at DESC
                        LIMIT 10
                    `, [student.id], (err, assessments) => {
                        if (err) reject(err);
                        else resolve(assessments || []);
                    });
                }),
                new Promise((resolve, reject) => {
                    db.all(`
                        SELECT ss.*, st.theme_name, lp.topic_name, st.theme_id as display_theme_id
                        FROM study_sessions ss
                        JOIN study_themes st ON ss.theme_id = st.id
                        JOIN learning_paths lp ON ss.topic_id = lp.id
                        WHERE ss.user_id = ?
                        ORDER BY ss.created_at DESC
                        LIMIT 10
                    `, [student.id], (err, sessions) => {
                        if (err) reject(err);
                        else resolve(sessions || []);
                    });
                })
            ]);

            res.json({
                student: student,
                themes: themes,
                topicsByTheme: progress.reduce((acc, topic) => {
                    if (!acc[topic.theme_id]) {
                        acc[topic.theme_id] = [];
                    }
                    acc[topic.theme_id].push(topic);
                    return acc;
                }, {}),
                assessments: assessments,
                sessions: sessions
            });
        } catch (error) {
            res.status(500).json({ error: 'Erro ao carregar interface do aluno' });
        }
    });
});

app.get('/admin/users', authenticateToken, requireRole(['admin']), (req, res) => {
    db.get('SELECT COUNT(*) as count FROM users', (err, result) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao carregar estatísticas' });
        }
        res.json({ count: result.count });
    });
});

app.get('/admin/teachers', authenticateToken, requireRole(['admin']), (req, res) => {
    db.get("SELECT COUNT(*) as count FROM users WHERE role = 'teacher'", (err, result) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao carregar estatísticas' });
        }
        res.json({ count: result.count });
    });
});

app.get('/admin/certificates', authenticateToken, requireRole(['admin']), (req, res) => {
    db.get('SELECT COUNT(*) as count FROM certificates', (err, result) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao carregar estatísticas' });
        }
        res.json({ count: result.count });
    });
});

app.get('/admin/assessments', authenticateToken, requireRole(['admin']), (req, res) => {
    db.get('SELECT COUNT(*) as count FROM assessments WHERE is_annulled = 0', (err, result) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao carregar estatísticas' });
        }
        res.json({ count: result.count });
    });
});

app.post('/admin/make-teacher', authenticateToken, requireRole(['admin']), (req, res) => {
    const { user_id } = req.body;

    if (!user_id) {
        return res.status(400).json({ error: 'ID do usuário é obrigatório' });
    }

    db.run('UPDATE users SET role = "teacher" WHERE user_id = ?', [user_id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Erro ao promover usuário' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        res.json({ message: 'Usuário promovido a professor com sucesso' });
    });
});

app.post('/admin/skip-topic', authenticateToken, requireRole(['admin']), (req, res) => {
    const { user_id, topic_id } = req.body;

    if (!user_id || !topic_id) {
        return res.status(400).json({ error: 'ID do usuário e tópico são obrigatórios' });
    }

    db.run(`UPDATE learning_paths
            SET progress = 100, status = 'completed', completed_at = CURRENT_TIMESTAMP
            WHERE topic_id = ? AND user_id = (SELECT id FROM users WHERE user_id = ?)`,
        [topic_id, user_id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Erro ao pular tópico' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Tópico não encontrado' });
        }
        res.json({ message: 'Tópico pulado com sucesso' });
    });
});

app.post('/admin/grant-certificate', authenticateToken, requireRole(['admin']), (req, res) => {
    const { user_id, theme_id } = req.body;

    if (!user_id || !theme_id) {
        return res.status(400).json({ error: 'ID do usuário e tema são obrigatórios' });
    }

    const certificateCode = generateCertificateCode();

    db.get(`SELECT up.full_name, st.theme_name, st.tag, st.theme_id as display_theme_id
            FROM user_profiles up
            JOIN study_themes st ON st.theme_id = ?
            WHERE up.user_id = (SELECT id FROM users WHERE user_id = ?)`, [theme_id, user_id], (err, result) => {
        if (err || !result) {
            return res.status(404).json({ error: 'Usuário ou tema não encontrado' });
        }

        const pdfHash = generateCertificateHash({
            certificate_code: certificateCode,
            full_name: result.full_name,
            theme_name: result.theme_name,
            tag: result.tag,
            issue_date: new Date().toISOString()
        });

        db.run(`INSERT INTO certificates (user_id, theme_id, certificate_code, full_name, theme_name, tag, pdf_hash)
                VALUES ((SELECT id FROM users WHERE user_id = ?), (SELECT id FROM study_themes WHERE theme_id = ?), ?, ?, ?, ?, ?)`,
            [user_id, theme_id, certificateCode, result.full_name, result.theme_name, result.tag, pdfHash], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Erro ao conceder certificado' });
            }
            res.json({
                message: 'Certificado concedido com sucesso',
                certificate_code: certificateCode,
                theme_id: result.display_theme_id
            });
        });
    });
});

app.put('/user/preferences/theme', authenticateToken, (req, res) => {
    const { theme } = req.body;

    if (!theme || !['light', 'dark'].includes(theme)) {
        return res.status(400).json({ error: 'Tema deve ser light ou dark' });
    }

    db.run('UPDATE user_preferences SET theme = ? WHERE user_id = ?', [theme, req.user.id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Erro ao atualizar tema' });
        }
        res.json({ message: 'Tema atualizado com sucesso' });
    });
});

app.get('/user/ids', authenticateToken, (req, res) => {
    db.get('SELECT user_id, user_code FROM users WHERE id = ?', [req.user.id], (err, user) => {
        if (err || !user) {
            return res.status(500).json({ error: 'Erro ao carregar IDs' });
        }
        res.json(user);
    });
});

app.get('/learning-paths/ids/:themeId', authenticateToken, (req, res) => {
    const { themeId } = req.params;

    db.all('SELECT topic_id, topic_code, topic_name FROM learning_paths WHERE theme_id = ? AND user_id = ? ORDER BY topic_order',
        [themeId, req.user.id], (err, topics) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao carregar IDs dos tópicos' });
        }
        res.json({ topics: topics || [] });
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
});

app.use((err, req, res, next) => {
    console.error('Erro não tratado:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
});

app.listen(PORT, () => {
    console.log(`Servidor ASS rodando na porta ${PORT}`);
    console.log(`Acesse: http://localhost:${PORT}`);
});

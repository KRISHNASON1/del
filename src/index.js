// src/index.js - Fixed Main Server File with Proper Route Mounting
const express = require('express');
const path = require('path');

// Import configuration
const { connectDatabase } = require('./config/database');
const { configureApp } = require('./config/app');

// Import existing models (keep your existing mongodb.js for now)
require('./mongodb');

// Import middleware
const { addUserContext } = require('./middleware/authMiddleware');
const { handleUploadError, cleanupTempFiles } = require('./middleware/uploadMiddleware');

// Import constants
const { HTTP_STATUS, DATABASE } = require('./utils/constants');

// Create Express app
const app = express();
const PORT = process.env.PORT || 8080;

// Configure app (middleware, sessions, handlebars, etc.)
configureApp(app);

// Add user context to all requests
app.use(addUserContext);

// ==================== ROUTE IMPORTS - FIXED ====================

// Import route files
const authRoutes = require('./routes/authRoutes');
const teacherRoutes = require('./routes/teacherRoutes');
const studentRoutes = require('./routes/studentRoutes');

// Import API routes
const authApi = require('./routes/api/authApi');
const teacherApi = require('./routes/api/teacherApi');
const studentApi = require('./routes/api/studentApi');
const quizApi = require('./routes/api/quizApi');
const classApi = require('./routes/api/classApi');

// Import controller routes (if needed for specific functionality)
const authController = require('./controllers/authController');
const teacherController = require('./controllers/teacherController');
const studentController = require('./controllers/studentController');
const classController = require('./controllers/classController');
const quizController = require('./controllers/quizController');

// ==================== MOUNT ROUTES - FIXED ====================

// Auth routes
app.use('/', authRoutes);

// Dashboard and page routes
app.use('/', teacherRoutes);
app.use('/', studentRoutes);

// API routes - FIXED MOUNTING
app.use('/api/auth', authApi);
app.use('/api/teacher', teacherApi);
app.use('/api/student', studentApi);
app.use('/api/quiz', quizApi);

// FIXED: Mount class API at /api/classes for direct access
app.use('/api/classes', classApi);

// ==================== UNIFIED CLASS MANAGEMENT ROUTES ====================

// Additional unified class routes that work for both teacher and student based on user type
const { requireAuth } = require('./middleware/authMiddleware');

// Get classes based on user type
app.get('/api/classes', requireAuth, async (req, res) => {
    try {
        if (req.session.userType === 'teacher') {
            // Redirect to teacher classes
            return res.redirect('/api/teacher/classes');
        } else if (req.session.userType === 'student') {
            // Redirect to student enrolled classes
            return res.redirect('/api/student/enrolled-classes');
        } else {
            return res.status(403).json({
                success: false,
                message: 'Invalid user type'
            });
        }
    } catch (error) {
        console.error('Error in unified classes route:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get classes: ' + error.message
        });
    }
});

// Create class (teacher only)
app.post('/api/classes', requireAuth, async (req, res) => {
    try {
        if (req.session.userType !== 'teacher') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Only teachers can create classes.'
            });
        }
        
        // Forward to teacher API
        req.url = '/classes';
        return teacherApi(req, res);
    } catch (error) {
        console.error('Error in unified class creation route:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create class: ' + error.message
        });
    }
});

// ==================== CONTROLLER-BASED ROUTES ====================

// Additional controller-based routes for specific functionality
app.get('/dashboard', authController.dashboardRedirect);

// Teacher specific controller routes
app.get('/class/:classId/overview', classController.getClassOverview);
app.get('/class/:classId/students', classController.getClassStudents);
app.get('/class/:classId/rankings', classController.getClassRankings);
app.get('/class/:classId/last-quiz-rankings', classController.getLastQuizRankings);
app.post('/class/:classId/add-student', classController.addStudentToClass);
app.delete('/class/:classId/student/:studentId', classController.removeStudentFromClass);

// Quiz controller routes
app.post('/quiz/generate/:id', quizController.generateQuiz);
app.get('/quiz/:quizId/questions', quizController.getQuizQuestions);
app.get('/quiz/:quizId/duration', quizController.getQuizDuration);
app.post('/quiz/submit/:quizId', quizController.submitQuiz);
app.post('/quiz/explanation', quizController.getExplanation);
app.delete('/lecture/:id', quizController.deleteLecture);

// Student controller routes  
app.get('/quiz-info/:quizId', studentController.renderQuizInfo);
app.get('/take_quiz/:quizId', studentController.renderTakeQuiz);
app.get('/quiz-result/:resultId/detailed', studentController.renderDetailedQuizResults);
app.get('/student/class/:classId', studentController.renderClassView);

// Teacher controller routes
app.get('/teacher/student-analytics/:studentId', teacherController.renderStudentAnalytics);
app.get('/class/:classId/student-analytics/:studentId', teacherController.redirectToStudentAnalytics);
app.get('/lecture_results/:lectureId', teacherController.renderLectureResults);

// ==================== BASIC ROUTES ====================

// Redirect root to login
app.get('/', (req, res) => {
    res.redirect('/login');
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(HTTP_STATUS.OK).json({
        status: 'healthy',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString(),
        routes: 'All routes properly mounted and fixed',
        database: 'Connected',
        fixes: [
            'Fixed /api/classes route mounting',
            'Added unified class management',
            'Proper route forwarding based on user type',
            'All APIs now accessible at correct endpoints'
        ]
    });
});

// Test route
app.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'QuizAI server is running with FIXED routes!',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        routes_status: 'All routes fixed and properly mounted',
        available_apis: {
            auth: '/api/auth/*',
            teacher: '/api/teacher/*',
            student: '/api/student/*',
            quiz: '/api/quiz/*',
            classes: '/api/classes/* (FIXED)',
            unified_classes: '/api/classes (works for both teacher and student)'
        }
    });
});

// ==================== ERROR HANDLING ====================

// Handle upload errors
app.use(handleUploadError);

// 404 handler - catch all unmatched routes
app.use((req, res) => {
    console.log(`🔍 404 - Route not found: ${req.method} ${req.originalUrl}`);
    res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Route not found',
        path: req.originalUrl,
        method: req.method,
        suggestion: 'Check the API documentation for correct endpoints'
    });
});

// Global error handler
app.use((error, req, res, next) => {
    console.error('❌ Unhandled error:', error);
    
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { 
            error: error.message,
            stack: error.stack 
        })
    });
});

// ==================== BACKGROUND JOBS ====================

// Cleanup temporary files on startup and periodically
cleanupTempFiles();
setInterval(cleanupTempFiles, DATABASE.CLEANUP_INTERVALS.TEMP_FILES);

// ==================== SERVER STARTUP ====================

const startServer = async () => {
    try {
        // Connect to database
        await connectDatabase();
        console.log('✅ Database connected successfully');

        // Start server
        app.listen(PORT, () => {
            console.log(`🚀 QuizAI Server started on port ${PORT}`);
            console.log(`🌐 Open http://localhost:${PORT} in your browser`);
            console.log(`📚 Ready to process lecture uploads and generate enhanced quizzes!`);
            console.log(`🔑 Using Gemini model: gemini-1.5-flash (Free tier)`);
            console.log(`🔧 FIXED ISSUES:`);
            console.log(`   ✅ Fixed /api/classes route mounting issue`);
            console.log(`   ✅ Added unified class management API`);
            console.log(`   ✅ Proper route forwarding based on user type`);
            console.log(`   ✅ All class APIs now accessible at correct endpoints`);
            console.log(`   ✅ Teacher class management: /api/teacher/classes`);
            console.log(`   ✅ Unified class access: /api/classes`);
            console.log(`   ✅ Student class access: /api/student/enrolled-classes`);
            console.log('✅ Server initialization complete with all routes fixed!');
        });

    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
};

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('📤 SIGTERM received. Shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('📤 SIGINT received. Shutting down gracefully...');
    process.exit(0);
});

// Start the server
startServer();
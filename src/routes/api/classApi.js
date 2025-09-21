// routes/api/classApi.js - FIXED VERSION
const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../../middleware/authMiddleware');

// Import database collections
const {
    studentCollection,
    teacherCollection,
    classCollection,
    classStudentCollection,
    quizCollection,
    quizResultCollection,
    classJoinCodeCollection,
    classJoinRequestCollection
} = require('../../mongodb');

// Import utility functions
const { formatPercentage, calculateTimeEfficiency, calculateRankingPoints, calculateParticipationWeightedPoints, formatTime, getTimeAgo } = require('../../utils/helpers');

// Middleware to ensure teacher access
const requireTeacher = requireRole('teacher');
const requireStudent = requireRole('student');

// ==================== UNIFIED CLASS MANAGEMENT APIs ====================

// Get classes based on user type
router.get('/', requireAuth, async (req, res) => {
    try {
        const userType = req.session.userType;
        const userId = req.session.userId;

        console.log('Unified classes API accessed:', {
            userType: userType,
            userId: userId,
            userName: req.session.userName
        });

        if (userType === 'teacher') {
            // Get teacher's classes
            const classes = await classCollection.find({
                teacherId: userId,
                isActive: true
            }).sort({ createdAt: -1 }).lean();

            console.log(`Found ${classes.length} classes for teacher ${req.session.userName}`);

            const formattedClasses = classes.map(classDoc => ({
                id: classDoc._id,
                name: classDoc.name,
                subject: classDoc.subject,
                description: classDoc.description,
                studentCount: classDoc.studentCount || 0,
                lectureCount: classDoc.lectureCount || 0,
                quizCount: classDoc.quizCount || 0,
                averageScore: classDoc.averageScore || 0,
                createdAt: classDoc.createdAt,
                updatedAt: classDoc.updatedAt
            }));

            res.json({
                success: true,
                classes: formattedClasses,
                totalClasses: formattedClasses.length,
                userType: 'teacher'
            });

        } else if (userType === 'student') {
            // Get student's enrolled classes
            const enrollments = await classStudentCollection.find({
                studentId: userId,
                isActive: true
            }).lean();

            if (enrollments.length === 0) {
                return res.json({
                    success: true,
                    classes: [],
                    totalClasses: 0,
                    userType: 'student',
                    message: 'No enrolled classes found.'
                });
            }

            const classIds = enrollments.map(e => e.classId);
            const classes = await classCollection.find({
                _id: { $in: classIds },
                isActive: true
            }).lean();

            // Get student's performance in each class
            const enrolledClasses = await Promise.all(
                classes.map(async (cls) => {
                    const enrollment = enrollments.find(e => 
                        e.classId.toString() === cls._id.toString()
                    );

                    const studentResults = await quizResultCollection.find({
                        studentId: userId,
                        classId: cls._id
                    }).lean();

                    const availableQuizzes = await quizCollection.countDocuments({
                        classId: cls._id,
                        isActive: true
                    });

                    const quizzesTaken = studentResults.length;
                    const averageScore = quizzesTaken > 0
                        ? (studentResults.reduce((sum, result) => sum + result.percentage, 0) / quizzesTaken)
                        : 0;

                    return {
                        id: cls._id,
                        name: cls.name,
                        subject: cls.subject,
                        description: cls.description,
                        enrolledAt: enrollment.enrolledAt,
                        quizzesTaken: quizzesTaken,
                        averageScore: parseFloat(averageScore.toFixed(1)),
                        availableQuizzes: availableQuizzes,
                        completionRate: availableQuizzes > 0 ? 
                            parseFloat(((quizzesTaken / availableQuizzes) * 100).toFixed(1)) : 0
                    };
                })
            );

            console.log(`Found ${enrolledClasses.length} enrolled classes for student ${req.session.userName}`);

            res.json({
                success: true,
                classes: enrolledClasses,
                totalClasses: enrolledClasses.length,
                userType: 'student'
            });

        } else {
            return res.status(403).json({
                success: false,
                message: 'Invalid user type'
            });
        }

    } catch (error) {
        console.error('Error in unified classes API:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch classes: ' + error.message
        });
    }
});

// Create new class (teacher only)
router.post('/', requireTeacher, async (req, res) => {
    try {
        const { name, subject, description } = req.body;
        const teacherId = req.session.userId;
        const teacherName = req.session.userName;

        console.log('Creating new class:', {
            name: name,
            subject: subject,
            teacherId: teacherId,
            teacherName: teacherName
        });

        if (!name || !subject) {
            return res.status(400).json({
                success: false,
                message: 'Class name and subject are required.'
            });
        }

        // Check if class name already exists for this teacher
        const existingClass = await classCollection.findOne({
            teacherId: teacherId,
            name: name.trim(),
            isActive: true
        });

        if (existingClass) {
            return res.status(400).json({
                success: false,
                message: 'You already have a class with this name.'
            });
        }

        // Create new class
        const newClass = await classCollection.create({
            name: name.trim(),
            subject: subject.trim(),
            description: description?.trim() || '',
            teacherId: teacherId,
            teacherName: teacherName,
            studentCount: 0,
            lectureCount: 0,
            quizCount: 0,
            averageScore: 0
        });

        console.log(`✅ New class created: ${newClass.name} by ${teacherName}`);

        res.json({
            success: true,
            message: 'Class created successfully!',
            class: {
                id: newClass._id,
                name: newClass.name,
                subject: newClass.subject,
                description: newClass.description,
                studentCount: 0,
                lectureCount: 0,
                quizCount: 0,
                averageScore: 0,
                createdAt: newClass.createdAt
            }
        });

    } catch (error) {
        console.error('Error creating class:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create class: ' + error.message
        });
    }
});

// Get specific class details
router.get('/:classId', requireAuth, async (req, res) => {
    try {
        const classId = req.params.classId;
        const userId = req.session.userId;
        const userType = req.session.userType;

        const classDoc = await classCollection.findOne({
            _id: classId,
            isActive: true
        }).lean();

        if (!classDoc) {
            return res.status(404).json({
                success: false,
                message: 'Class not found.'
            });
        }

        // Check access permissions
        if (userType === 'teacher') {
            if (classDoc.teacherId.toString() !== userId.toString()) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied. You do not own this class.'
                });
            }
        } else if (userType === 'student') {
            const enrollment = await classStudentCollection.findOne({
                studentId: userId,
                classId: classId,
                isActive: true
            });

            if (!enrollment) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied. You are not enrolled in this class.'
                });
            }
        }

        res.json({
            success: true,
            class: {
                id: classDoc._id,
                name: classDoc.name,
                subject: classDoc.subject,
                description: classDoc.description,
                studentCount: classDoc.studentCount || 0,
                lectureCount: classDoc.lectureCount || 0,
                quizCount: classDoc.quizCount || 0,
                averageScore: classDoc.averageScore || 0,
                createdAt: classDoc.createdAt,
                updatedAt: classDoc.updatedAt
            }
        });

    } catch (error) {
        console.error('Error fetching class:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch class: ' + error.message
        });
    }
});

// ==================== JOIN CODE MANAGEMENT APIs ====================

// Generate join code for class (teacher only)
router.post('/:classId/generate-join-code', requireTeacher, async (req, res) => {
    try {
        const classId = req.params.classId;
        const teacherId = req.session.userId;

        console.log('Generating join code for class:', {
            classId: classId,
            teacherId: teacherId,
            teacherName: req.session.userName
        });

        // Verify class ownership
        const classDoc = await classCollection.findOne({
            _id: classId,
            teacherId: teacherId,
            isActive: true
        });

        if (!classDoc) {
            return res.status(404).json({
                success: false,
                message: 'Class not found or access denied.'
            });
        }

        // Deactivate any existing active codes for this class
        await classJoinCodeCollection.updateMany(
            {
                classId: classId,
                isActive: true
            },
            {
                isActive: false
            }
        );

        // Generate unique 6-digit code
        const joinCode = await classJoinCodeCollection.generateUniqueCode();

        // Set expiry to 10 minutes from now
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        // Create new join code
        const newJoinCode = await classJoinCodeCollection.create({
            classId: classId,
            teacherId: teacherId,
            className: classDoc.name,
            classSubject: classDoc.subject,
            teacherName: req.session.userName,
            joinCode: joinCode,
            expiresAt: expiresAt,
            isActive: true,
            usageCount: 0,
            maxUsage: 50
        });

        console.log('✅ Join code generated:', {
            joinCode: joinCode,
            expiresAt: expiresAt,
            className: classDoc.name
        });

        res.json({
            success: true,
            message: 'Join code generated successfully!',
            joinCode: joinCode,
            expiresAt: expiresAt,
            expiresInMinutes: 10,
            className: classDoc.name,
            classSubject: classDoc.subject,
            usageCount: 0,
            maxUsage: 50
        });

    } catch (error) {
        console.error('Error generating join code:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate join code: ' + error.message
        });
    }
});

// Get active join code for class (teacher only)
router.get('/:classId/active-join-code', requireTeacher, async (req, res) => {
    try {
        const classId = req.params.classId;
        const teacherId = req.session.userId;

        // Verify class ownership
        const classDoc = await classCollection.findOne({
            _id: classId,
            teacherId: teacherId,
            isActive: true
        });

        if (!classDoc) {
            return res.status(404).json({
                success: false,
                message: 'Class not found or access denied.'
            });
        }

        // Find active join code
        const activeCode = await classJoinCodeCollection.findOne({
            classId: classId,
            isActive: true,
            expiresAt: { $gt: new Date() }
        });

        if (!activeCode) {
            return res.json({
                success: true,
                hasActiveCode: false,
                message: 'No active join code found.'
            });
        }

        res.json({
            success: true,
            hasActiveCode: true,
            joinCode: activeCode.joinCode,
            expiresAt: activeCode.expiresAt,
            usageCount: activeCode.usageCount,
            maxUsage: activeCode.maxUsage,
            remainingTime: Math.max(0, Math.floor((activeCode.expiresAt - new Date()) / 1000))
        });

    } catch (error) {
        console.error('Error fetching active join code:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch join code: ' + error.message
        });
    }
});

// Validate join code (student)
router.get('/validate-join-code/:code', requireStudent, async (req, res) => {
    try {
        const joinCode = req.params.code.toUpperCase();
        const studentId = req.session.userId;

        console.log('Validating join code:', {
            joinCode: joinCode,
            studentId: studentId,
            studentName: req.session.userName
        });

        // Find the join code
        const codeDoc = await classJoinCodeCollection.findOne({
            joinCode: joinCode,
            isActive: true
        });

        if (!codeDoc) {
            return res.status(404).json({
                success: false,
                message: 'Invalid or expired join code.'
            });
        }

        // Check if code is expired
        if (codeDoc.isExpired()) {
            await classJoinCodeCollection.findByIdAndUpdate(codeDoc._id, { isActive: false });
            return res.status(400).json({
                success: false,
                message: 'This join code has expired.'
            });
        }

        // Check if code can still be used
        if (!codeDoc.canBeUsed()) {
            return res.status(400).json({
                success: false,
                message: 'This join code has reached its usage limit.'
            });
        }

        // Check if student is already enrolled in this class
        const existingEnrollment = await classStudentCollection.findOne({
            classId: codeDoc.classId,
            studentId: studentId,
            isActive: true
        });

        if (existingEnrollment) {
            return res.status(400).json({
                success: false,
                message: 'You are already enrolled in this class.'
            });
        }

        // Check if student already has a pending request for this class
        const existingRequest = await classJoinRequestCollection.findOne({
            classId: codeDoc.classId,
            studentId: studentId,
            status: 'pending'
        });

        if (existingRequest) {
            return res.status(400).json({
                success: false,
                message: 'You already have a pending request for this class.'
            });
        }

        console.log('✅ Join code validated successfully:', {
            className: codeDoc.className,
            teacherName: codeDoc.teacherName
        });

        res.json({
            success: true,
            valid: true,
            classInfo: {
                classId: codeDoc.classId,
                className: codeDoc.className,
                classSubject: codeDoc.classSubject,
                teacherName: codeDoc.teacherName,
                expiresAt: codeDoc.expiresAt,
                remainingTime: Math.max(0, Math.floor((codeDoc.expiresAt - new Date()) / 1000))
            }
        });

    } catch (error) {
        console.error('Error validating join code:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to validate join code: ' + error.message
        });
    }
});

// ==================== JOIN REQUEST MANAGEMENT APIs ====================

// Submit join request (student)
router.post('/join-request', requireStudent, async (req, res) => {
    try {
        const { joinCode } = req.body;
        const studentId = req.session.userId;
        const studentName = req.session.userName;

        console.log('Processing join request:', {
            joinCode: joinCode,
            studentId: studentId,
            studentName: studentName
        });

        if (!joinCode) {
            return res.status(400).json({
                success: false,
                message: 'Join code is required.'
            });
        }

        // Get student enrollment number
        const student = await studentCollection.findById(studentId).select('enrollment');
        if (!student) {
            return res.status(404).json({
                success: false,
                message: 'Student record not found.'
            });
        }

        // Find and validate the join code
        const codeDoc = await classJoinCodeCollection.findOne({
            joinCode: joinCode.toUpperCase(),
            isActive: true
        });

        if (!codeDoc || codeDoc.isExpired() || !codeDoc.canBeUsed()) {
            return res.status(400).json({
                success: false,
                message: 'Invalid, expired, or overused join code.'
            });
        }

        // Check for existing enrollment and handle reactivation
        const existingClassStudentEntry = await classStudentCollection.findOne({
            classId: codeDoc.classId,
            studentId: studentId
        });

        if (existingClassStudentEntry) {
            if (existingClassStudentEntry.isActive) {
                return res.status(400).json({
                    success: false,
                    message: 'You are already enrolled in this class.'
                });
            } else {
                // Reactivate inactive enrollment
                await classStudentCollection.findByIdAndUpdate(existingClassStudentEntry._id, {
                    isActive: true,
                    enrolledAt: new Date(),
                    studentName: studentName,
                    studentEnrollment: student.enrollment
                });

                // Update join requests to approved
                await classJoinRequestCollection.updateMany(
                    { classId: codeDoc.classId, studentId: studentId, status: { $in: ['pending', 'rejected'] } },
                    { status: 'approved', processedAt: new Date() }
                );

                // Increment usage count
                await classJoinCodeCollection.findByIdAndUpdate(codeDoc._id, { $inc: { usageCount: 1 } });

                // Update class student count
                const totalActiveStudents = await classStudentCollection.countDocuments({
                    classId: codeDoc.classId,
                    isActive: true
                });
                await classCollection.findByIdAndUpdate(codeDoc.classId, {
                    studentCount: totalActiveStudents,
                    updatedAt: new Date()
                });

                return res.json({
                    success: true,
                    message: `You have successfully rejoined ${codeDoc.className}!`,
                    classInfo: {
                        className: codeDoc.className,
                        classSubject: codeDoc.classSubject,
                        teacherName: codeDoc.teacherName
                    }
                });
            }
        }

        // Check for existing join requests
        const existingJoinRequest = await classJoinRequestCollection.findOne({
            classId: codeDoc.classId,
            studentId: studentId
        });

        if (existingJoinRequest) {
            if (existingJoinRequest.status === 'pending') {
                return res.status(400).json({
                    success: false,
                    message: 'You already have a pending request for this class. Please wait for the teacher\'s approval.'
                });
            } else if (existingJoinRequest.status === 'rejected') {
                // Delete previous rejected request to allow new one
                await classJoinRequestCollection.deleteOne({ _id: existingJoinRequest._id });
            }
        }

        // Create new join request
        const joinRequest = await classJoinRequestCollection.create({
            classId: codeDoc.classId,
            studentId: studentId,
            studentName: studentName,
            studentEnrollment: student.enrollment,
            joinCode: joinCode.toUpperCase(),
            className: codeDoc.className,
            classSubject: codeDoc.classSubject,
            teacherId: codeDoc.teacherId,
            teacherName: codeDoc.teacherName,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')?.substring(0, 500)
        });

        // Increment usage count
        await classJoinCodeCollection.findByIdAndUpdate(codeDoc._id, { $inc: { usageCount: 1 } });

        console.log('✅ New join request created:', {
            requestId: joinRequest._id,
            className: codeDoc.className,
            teacherName: codeDoc.teacherName
        });

        res.json({
            success: true,
            message: `Join request sent successfully! Waiting for ${codeDoc.teacherName} to approve your request.`,
            requestId: joinRequest._id,
            classInfo: {
                className: codeDoc.className,
                classSubject: codeDoc.classSubject,
                teacherName: codeDoc.teacherName
            }
        });

    } catch (error) {
        console.error('Error submitting join request:', error);
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'A request for this class already exists or you are already enrolled.'
            });
        }
        res.status(500).json({
            success: false,
            message: 'Failed to submit join request: ' + error.message
        });
    }
});

// ==================== ADDITIONAL CLASS MANAGEMENT ====================

// Get pending requests for class (teacher)
router.get('/:classId/join-requests', requireTeacher, async (req, res) => {
    try {
        const classId = req.params.classId;
        const teacherId = req.session.userId;

        // Verify class ownership
        const classDoc = await classCollection.findOne({
            _id: classId,
            teacherId: teacherId,
            isActive: true
        });

        if (!classDoc) {
            return res.status(404).json({
                success: false,
                message: 'Class not found or access denied.'
            });
        }

        // Get pending requests
        const pendingRequests = await classJoinRequestCollection.find({
            classId: classId,
            status: 'pending'
        }).sort({ requestedAt: -1 });

        const formattedRequests = pendingRequests.map(request => ({
            requestId: request._id,
            studentName: request.studentName,
            studentEnrollment: request.studentEnrollment,
            joinCode: request.joinCode,
            requestedAt: request.requestedAt,
            timeAgo: getTimeAgo(request.requestedAt)
        }));

        res.json({
            success: true,
            requests: formattedRequests,
            totalPending: formattedRequests.length,
            className: classDoc.name
        });

    } catch (error) {
        console.error('Error fetching join requests:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch join requests: ' + error.message
        });
    }
});

// Approve/reject join request (teacher)
router.post('/:classId/join-requests/:requestId/:action', requireTeacher, async (req, res) => {
    try {
        const { classId, requestId, action } = req.params;
        const teacherId = req.session.userId;

        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid action. Must be "approve" or "reject".'
            });
        }

        // Verify class ownership
        const classDoc = await classCollection.findOne({
            _id: classId,
            teacherId: teacherId,
            isActive: true
        });

        if (!classDoc) {
            return res.status(404).json({
                success: false,
                message: 'Class not found or access denied.'
            });
        }

        // Find the join request
        const joinRequest = await classJoinRequestCollection.findOne({
            _id: requestId,
            classId: classId,
            status: 'pending'
        });

        if (!joinRequest) {
            return res.status(404).json({
                success: false,
                message: 'Join request not found or already processed.'
            });
        }

        if (action === 'approve') {
            // Handle enrollment logic (reactivate or create new)
            const existingEnrollment = await classStudentCollection.findOne({
                classId: classId,
                studentId: joinRequest.studentId
            });

            if (existingEnrollment) {
                if (existingEnrollment.isActive) {
                    await joinRequest.approve(teacherId);
                    return res.status(400).json({
                        success: false,
                        message: 'Student is already enrolled in this class.'
                    });
                } else {
                    await classStudentCollection.findByIdAndUpdate(existingEnrollment._id, {
                        isActive: true,
                        enrolledAt: new Date(),
                        studentName: joinRequest.studentName,
                        studentEnrollment: joinRequest.studentEnrollment
                    });
                }
            } else {
                await classStudentCollection.create({
                    classId: classId,
                    studentId: joinRequest.studentId,
                    studentName: joinRequest.studentName,
                    studentEnrollment: joinRequest.studentEnrollment,
                    enrolledAt: new Date(),
                    isActive: true
                });
            }

            await joinRequest.approve(teacherId);

            // Update class student count
            const totalActiveStudents = await classStudentCollection.countDocuments({
                classId: classId,
                isActive: true
            });

            await classCollection.findByIdAndUpdate(classId, {
                studentCount: totalActiveStudents,
                updatedAt: new Date()
            });

            res.json({
                success: true,
                message: `${joinRequest.studentName} has been added to the class successfully!`,
                action: 'approved',
                studentName: joinRequest.studentName,
                studentEnrollment: joinRequest.studentEnrollment
            });

        } else if (action === 'reject') {
            await joinRequest.reject(teacherId, 'Request rejected by teacher');

            res.json({
                success: true,
                message: `Join request from ${joinRequest.studentName} has been rejected.`,
                action: 'rejected',
                studentName: joinRequest.studentName,
                rejectionReason: 'Request rejected by teacher'
            });
        }

    } catch (error) {
        console.error('Error processing join request:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to process join request: ' + error.message
        });
    }
});

module.exports = router;
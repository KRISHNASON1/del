// routes/authRoutes.js - Fixed with all necessary imports
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { isAuthenticated } = require('../middleware/authMiddleware');
const { validateRegistration, validateLogin } = require('../middleware/validationMiddleware');

// Import database collections
const {
    studentCollection,
    teacherCollection
} = require('../mongodb');

// Import email services
const { sendEmail } = require('../services/emailService');
const { renderEmailTemplate } = require('../utils/templateRenderer');

// Constants
const VERIFICATION_TOKEN_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours
const PASSWORD_RESET_TOKEN_EXPIRY = 60 * 60 * 1000; // 1 hour

// Redirect root to login
router.get('/', (req, res) => {
    res.redirect('/login');
});

// Login page
router.get('/login', (req, res) => {
    res.render('login', { message: req.query.message });
});

// Signup page
router.get('/signup', (req, res) => {
    res.render('signup');
});

// Signup form submission
router.post('/signup', validateRegistration, async (req, res) => {
    try {
        const { userType, name, email, enrollment, password } = req.body;
        const errors = {};

        console.log('Signup attempt:', {
            userType,
            name,
            email: email || 'N/A',
            enrollment: enrollment || 'N/A'
        });

        if (userType === 'teacher') {
            // Check if teacher email already exists
            const existingTeacher = await teacherCollection.findOne({ email: email });
            if (existingTeacher) {
                errors.email = "User with this email already exists.";
            }

            if (Object.keys(errors).length > 0) {
                return res.render("signup", { errors: errors, userType, name, email, enrollment });
            }

            // Create teacher with firstName/lastName from name
            const nameParts = name.trim().split(' ');
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || '';

            const teacherData = { 
                name: name.trim(), 
                firstName: firstName,
                lastName: lastName,
                email: email.toLowerCase().trim(), 
                password: password 
            };

            console.log('Creating teacher with data:', teacherData);
            
            await teacherCollection.insertMany([teacherData]);
            const newTeacher = await teacherCollection.findOne({ email: email.toLowerCase().trim() });
            
            req.session.userId = newTeacher._id;
            req.session.userName = newTeacher.name;
            req.session.userType = userType;

            req.session.save((err) => {
                if (err) {
                    console.error("Error saving session:", err);
                    return res.render("signup", { errors: { general: "Error during registration." } });
                }
                res.redirect(`/homeTeacher?userName=${encodeURIComponent(newTeacher.name)}`);
            });

        } else { // Student
            const upperCaseEnrollment = enrollment.toUpperCase();
            const existingStudent = await studentCollection.findOne({ enrollment: upperCaseEnrollment });
            if (existingStudent) {
                errors.enrollment = "User with this enrollment number already exists.";
            }

            if (Object.keys(errors).length > 0) {
                return res.render("signup", { errors: errors, userType, name, email, enrollment });
            }

            // Create student with firstName/lastName from name
            const nameParts = name.trim().split(' ');
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || '';

            const studentData = { 
                name: name.trim(), 
                firstName: firstName,
                lastName: lastName,
                enrollment: upperCaseEnrollment, 
                password: password 
            };

            if (email && email.trim()) {
                studentData.email = email.toLowerCase().trim();
            }

            console.log('Creating student with data:', studentData);
            
            await studentCollection.insertMany([studentData]);
            const newStudent = await studentCollection.findOne({ enrollment: upperCaseEnrollment });
            
            req.session.userId = newStudent._id;
            req.session.userName = newStudent.name;
            req.session.userType = userType;

            req.session.save((err) => {
                if (err) {
                    console.error("Error saving session:", err);
                    return res.render("signup", { errors: { general: "Error during registration." } });
                }
                res.redirect(`/homeStudent?userName=${encodeURIComponent(newStudent.name)}`);
            });
        }
    } catch (error) {
        console.error('Error in signup:', error);
        res.render("signup", { errors: { general: "An unexpected error occurred during registration. Please try again." } });
    }
});

// Login form submission
router.post('/login', validateLogin, async (req, res) => {
    try {
        const { password, userType, email, enrollment } = req.body;
        let user;
        const errors = {};
        const oldInput = { userType, email, enrollment };

        console.log('Login attempt:', {
            userType,
            email: email || 'N/A',
            enrollment: enrollment || 'N/A'
        });

        if (userType === 'teacher') {
            user = await teacherCollection.findOne({ email: email.toLowerCase().trim() });
            if (!user) {
                errors.email = "No user found with this email.";
            }
        } else { // Student
            const upperCaseEnrollment = enrollment ? enrollment.toUpperCase() : null;
            user = await studentCollection.findOne({ enrollment: upperCaseEnrollment });
            if (!user) {
                errors.enrollment = "No user found with this enrollment number.";
            }
        }

        if (Object.keys(errors).length > 0) {
            return res.render("login", { errors: errors, oldInput: oldInput });
        }

        // Check password
        if (user.password === password) {
            req.session.userId = user._id;
            req.session.userName = user.name;
            req.session.userType = userType;

            req.session.save((err) => {
                if (err) {
                    console.error("Error saving session:", err);
                    return res.render("login", { errors: { general: "Login failed due to an internal error." }, oldInput: oldInput });
                }
                const redirectUrl = userType === 'teacher' ? '/homeTeacher' : '/homeStudent';
                res.redirect(`${redirectUrl}?userName=${encodeURIComponent(user.name)}`);
            });

        } else {
            errors.password = "Wrong password.";
            return res.render("login", { errors: errors, oldInput: oldInput });
        }
    } catch (error) {
        console.error('Error in login:', error);
        res.render("login", { errors: { general: "An unexpected error occurred during login. Please try again." } });
    }
});

// Logout
router.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Error destroying session:', err);
            return res.status(500).send('Could not log out.');
        }
        res.redirect('/login?message=You have been logged out.');
    });
});

// Forgot password page
router.get('/forgot-password', (req, res) => {
    res.render('forgotPassword', {
        message: req.query.message,
        error: req.query.error
    });
});

// Forgot password form submission
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.redirect('/forgot-password?error=' + encodeURIComponent('Please enter your email address.'));
        }

        // Find user (student or teacher) by email
        let user = await studentCollection.findOne({ email: email.toLowerCase().trim() });
        if (!user) {
            user = await teacherCollection.findOne({ email: email.toLowerCase().trim() });
        }

        // Always send generic success message to prevent email enumeration
        if (!user) {
            console.log(`Password reset requested for non-existent email: ${email}`);
            return res.redirect('/forgot-password?message=' + encodeURIComponent('If an account with that email exists, a password reset link has been sent.'));
        }

        // Generate reset token and expiry
        user.resetPasswordToken = crypto.randomBytes(32).toString('hex');
        user.resetPasswordTokenExpires = new Date(Date.now() + PASSWORD_RESET_TOKEN_EXPIRY);
        await user.save();

        const resetLink = `${process.env.BASE_URL}/reset-password/${user.resetPasswordToken}`;

        const emailHtml = await renderEmailTemplate('resetPasswordEmail', {
            username: user.firstName || user.name,
            resetLink: resetLink
        });

        const emailResult = await sendEmail({
            to: user.email,
            subject: 'Quizzie: Password Reset Request',
            html: emailHtml,
            text: `Hello ${user.firstName || user.name},\n\nYou have requested to reset your password for your Quizzie account. Please click the following link to set a new password: ${resetLink}\n\nThis link will expire in 1 hour.\n\nIf you did not request a password reset, please ignore this email.\n\nBest regards,\nThe Quizzie Team`
        });

        if (emailResult.success) {
            return res.redirect('/forgot-password?message=' + encodeURIComponent('If an account with that email exists, a password reset link has been sent to your inbox.'));
        } else {
            console.error('Error sending password reset email:', emailResult.message);
            return res.redirect('/forgot-password?error=' + encodeURIComponent('Failed to send password reset email. Please try again later.'));
        }

    } catch (error) {
        console.error('Error in forgot password request:', error);
        return res.redirect('/forgot-password?error=' + encodeURIComponent('An unexpected error occurred. Please try again.'));
    }
});

// Reset password page
router.get('/reset-password/:token', async (req, res) => {
    try {
        const { token } = req.params;

        // Find user by token and check expiry
        let user = await studentCollection.findOne({
            resetPasswordToken: token,
            resetPasswordTokenExpires: { $gt: Date.now() }
        });
        if (!user) {
            user = await teacherCollection.findOne({
                resetPasswordToken: token,
                resetPasswordTokenExpires: { $gt: Date.now() }
            });
        }

        if (!user) {
            console.log('Invalid or expired password reset token provided.');
            return res.render('resetPassword', {
                error: 'The password reset link is invalid or has expired. Please request a new one.',
                token: ''
            });
        }

        res.render('resetPassword', {
            token: token,
            message: req.query.message,
            error: req.query.error
        });

    } catch (error) {
        console.error('Error rendering reset password page:', error);
        return res.render('resetPassword', {
            error: 'An unexpected error occurred. Please try again.',
            token: ''
        });
    }
});

// Reset password form submission
router.post('/reset-password/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const { newPassword, confirmNewPassword } = req.body;

        // Find user by token and check expiry
        let user = await studentCollection.findOne({
            resetPasswordToken: token,
            resetPasswordTokenExpires: { $gt: Date.now() }
        });
        if (!user) {
            user = await teacherCollection.findOne({
                resetPasswordToken: token,
                resetPasswordTokenExpires: { $gt: Date.now() }
            });
        }

        if (!user) {
            console.log('Invalid or expired password reset token during submission.');
            return res.render('resetPassword', {
                success: false,
                error: 'The password reset link is invalid or has expired. Please request a new one.',
                token: ''
            });
        }

        // Password validation
        if (newPassword !== confirmNewPassword) {
            return res.render('resetPassword', {
                success: false,
                error: 'Passwords do not match.',
                token: token
            });
        }
        if (newPassword.length < 6) {
            return res.render('resetPassword', {
                success: false,
                error: 'Password must be at least 6 characters long.',
                token: token
            });
        }

        // Update password and clear token fields
        user.password = newPassword; // Plain text for testing (as per original code)
        user.resetPasswordToken = undefined;
        user.resetPasswordTokenExpires = undefined;
        await user.save();

        console.log(`User ${user.email} password successfully reset.`);
        return res.render('resetPassword', {
            success: true,
            message: 'Your password has been successfully reset! You can now log in with your new password.'
        });

    } catch (error) {
        console.error('Error resetting password:', error);
        return res.render('resetPassword', {
            success: false,
            error: 'An unexpected error occurred while resetting password. Please try again.',
            token: req.params.token
        });
    }
});

// Email verification
router.get('/verify-email/:token', async (req, res) => {
    console.log('GET /verify-email/:token route hit');
    try {
        const { token } = req.params;
        console.log('Verification token received:', token);

        // Try to find user in studentCollection
        let user = await studentCollection.findOne({
            verificationToken: token,
            verificationTokenExpires: { $gt: Date.now() }
        });

        // If not found in studentCollection, try teacherCollection
        if (!user) {
            user = await teacherCollection.findOne({
                verificationToken: token,
                verificationTokenExpires: { $gt: Date.now() }
            });
        }

        if (!user) {
            console.log('Invalid or expired verification link provided.');
            return res.render('emailVerificationSuccess', {
                success: false,
                error: 'The verification link is invalid or has expired. Please try resending the verification email.'
            });
        }

        // Check if this is a pending email verification
        if (user.pendingEmail && user.verificationToken === token) {
            // This is a pending email change, apply it now
            user.email = user.pendingEmail;
            user.pendingEmail = undefined;
            user.isVerified = true;
            user.verificationToken = undefined;
            user.verificationTokenExpires = undefined;
            await user.save();
            console.log(`User ${user.email} (new) email successfully updated and verified.`);
            return res.render('emailVerificationSuccess', {
                success: true,
                message: 'Your email address has been successfully updated and verified!'
            });
        }
        // Handle initial registration verification
        else if (!user.isVerified && !user.pendingEmail && user.verificationToken === token) {
            user.isVerified = true;
            user.verificationToken = undefined;
            user.verificationTokenExpires = undefined;
            await user.save();
            console.log(`User ${user.email} (initial) email successfully verified.`);
            return res.render('emailVerificationSuccess', {
                success: true,
                message: 'Your email has been successfully verified! You can now log in.'
            });
        }
        // If already verified
        else if (user.isVerified) {
            console.log(`User ${user.email} email already verified.`);
            return res.render('emailVerificationSuccess', {
                success: false,
                error: 'Your email address is already verified. No action needed.'
            });
        }
        else {
            console.log('Unexpected verification state for token:', token);
            return res.render('emailVerificationSuccess', {
                success: false,
                error: 'An unexpected error occurred during verification. Please try again.'
            });
        }

    } catch (error) {
        console.error('Error verifying email:', error);
        return res.render('emailVerificationSuccess', {
            success: false,
            error: 'An internal server error occurred during verification. Please try again later.'
        });
    }
});

// Smart dashboard redirect
router.get('/dashboard', isAuthenticated, (req, res) => {
    try {
        const userType = req.session.userType;
        const userName = req.session.userName;

        console.log('Dashboard redirect requested:', {
            userType: userType,
            userName: userName,
            sessionId: req.sessionID
        });

        if (userType === 'teacher') {
            console.log('Redirecting teacher to homeTeacher');
            res.redirect('/homeTeacher');
        } else if (userType === 'student') {
            console.log('Redirecting student to homeStudent');
            res.redirect('/homeStudent');
        } else {
            console.log('Invalid user type or session, redirecting to login');
            res.redirect('/login?message=Invalid session. Please login again.');
        }
    } catch (error) {
        console.error('Error in dashboard redirect:', error);
        res.redirect('/login?message=Session error. Please login again.');
    }
});

// About developers page
router.get('/about-developers', (req, res) => {
    res.render('about-developers', {
        title: 'Meet Our Developers - Quizzie'
    });
});

module.exports = router;
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const User = require('./models/user');
const Order = require('./models/order');
const { sendEmail } = require('./utils/emailService');
const {
    findUserByEmail: findPteroUserByEmail,
    createPterodactylUser,
    createPterodactylServer,
    RESOURCE_MAP
} = require('./utils/pterodactyl');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const proofStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, 'uploads/proofs/');
        fs.mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        cb(null, uuidv4() + path.extname(file.originalname));
    }
});

const uploadProof = multer({
    storage: proofStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|gif|pdf/;
        if (filetypes.test(file.mimetype) && filetypes.test(path.extname(file.originalname).toLowerCase())) {
            return cb(null, true);
        }
        cb(new Error("Error: File upload only supports " + filetypes));
    }
}).single('paymentProof');

mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.error('MongoDB Connection Error:', err));

const authMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            req.user = await User.findById(decoded.userId).select('-password');
            if (!req.user) {
                 req.user = null;
            }
        } catch (error) {
            req.user = null;
            if (error.name !== 'TokenExpiredError') {
                console.error("Auth middleware error:", error.message);
            }
        }
    } else {
        req.user = null;
    }
    next();
};
app.use(authMiddleware);

const adminOnlyMiddleware = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: 'Forbidden: Admin access required.' });
    }
};

app.post('/api/auth/register', async (req, res) => {
    const { firstName, lastName, email, password } = req.body;
    if (!firstName || !lastName || !email || !password) {
        return res.status(400).json({ message: 'Please fill all fields.' });
    }
    try {
        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ message: 'User with this email already exists.' });
        }
        const newUser = new User({ firstName, lastName, email: email.toLowerCase(), password });
        await newUser.save();
        res.status(201).json({ message: 'User registered successfully. Please login.' });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ message: 'Server error during registration.' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'Please provide email and password.' });
    }
    try {
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }
        const token = jwt.sign({ userId: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        res.json({
            token,
            user: {
                id: user._id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Server error during login.' });
    }
});

app.get('/api/auth/status', (req, res) => {
    if (req.user) {
        res.json({
            isLoggedIn: true,
            user: {
                id: req.user._id,
                email: req.user.email,
                firstName: req.user.firstName,
                lastName: req.user.lastName,
                role: req.user.role
            }
        });
    } else {
        res.json({ isLoggedIn: false, user: null });
    }
});

app.post('/api/orders', (req, res) => {
    uploadProof(req, res, async (err) => {
        if (err) {
            return res.status(400).json({ message: err.message });
        }
        let { userEmail, productName, productPrice, productPriceFormatted, transactionId } = req.body;
        let siteUserId;

        if (req.user) {
            userEmail = req.user.email;
            siteUserId = req.user._id;
        } else if (!userEmail) {
            return res.status(400).json({ message: 'Email is required if not logged in.' });
        }

        if (!productName || !productPrice || !productPriceFormatted) {
            return res.status(400).json({ message: 'Missing product details.' });
        }
        try {
            if (!siteUserId) {
                let tempStoreUser = await User.findOne({ email: userEmail.toLowerCase() });
                if (!tempStoreUser) {
                     return res.status(400).json({ message: 'Please register or login before placing an order, or ensure your email is correct.' });
                }
                siteUserId = tempStoreUser._id;
            }

            const newOrder = new Order({
                user: siteUserId,
                productName,
                productPrice: Number(productPrice),
                productPriceFormatted,
                transactionId,
                paymentProofPath: req.file ? `/uploads/proofs/${req.file.filename}` : null
            });
            await newOrder.save();
            
            const storeUserForEmail = await User.findById(siteUserId);

            const adminSubject = `New Order Received: ${productName}`;
            const adminHtml = `
                <h1>New Order Received</h1>
                <p><strong>Order ID:</strong> ${newOrder._id}</p>
                <p><strong>Product:</strong> ${productName} (${productPriceFormatted})</p>
                <p><strong>User Email:</strong> ${storeUserForEmail.email}</p>
                <p><strong>Transaction ID:</strong> ${transactionId || 'N/A'}</p>
                <p><strong>Payment Proof:</strong> ${req.file ? `<a href="${process.env.BASE_URL}${newOrder.paymentProofPath}" target="_blank">View Proof</a>` : 'Not Uploaded'}</p>
                <p>To approve, visit the <a href="${process.env.BASE_URL}/admin.html">Admin Panel</a>.</p>
            `;
            await sendEmail(process.env.ADMIN_EMAIL, adminSubject, adminHtml);

            const userSubject = `Your Gxyenn Store Order Received: ${productName}`;
            const userHtml = `
                <h1>Thank You for Your Order!</h1>
                <p>Hi ${storeUserForEmail.firstName},</p>
                <p>We have received your order for <strong>${productName} (${productPriceFormatted})</strong>.</p>
                <p>Your Order ID is: <strong>${newOrder._id}</strong>.</p>
                <p>We will process your order shortly and notify you once it's approved and your panel is ready.</p>
                <p>Thanks,<br>Gxyenn Store Team</p>
            `;
            await sendEmail(storeUserForEmail.email, userSubject, userHtml);
            res.status(201).json({ message: 'Order submitted successfully. You will receive an email confirmation.', orderId: newOrder._id });
        } catch (error) {
            console.error('Error submitting order:', error);
            res.status(500).json({ message: 'Server error while submitting order.' });
        }
    });
});

app.post('/api/admin/orders/:orderId/approve', adminOnlyMiddleware, async (req, res) => {
    const { orderId } = req.params;
    try {
        const order = await Order.findById(orderId).populate('user');
        if (!order) return res.status(404).json({ message: 'Order not found.' });
        if (order.status === 'approved') return res.status(400).json({ message: 'Order already approved.' });
        if (!order.user) return res.status(400).json({ message: 'User (site account) not found for this order.' });

        const siteUser = order.user;
        const pteroUserEmail = siteUser.email;
        let pteroUserAttributes;
        let pterodactylPasswordForEmail;

        const existingPteroUser = await findPteroUserByEmail(pteroUserEmail);

        if (!existingPteroUser) {
            const newPteroUserData = await createPterodactylUser(pteroUserEmail, siteUser.firstName, siteUser.lastName, siteUser._id.toString());
            pteroUserAttributes = newPteroUserData;
            pterodactylPasswordForEmail = newPteroUserData.plainPassword;
            siteUser.pterodactylUserId = newPteroUserData.id;
            siteUser.pterodactylUsername = newPteroUserData.username;
            await siteUser.save();
        } else {
            pteroUserAttributes = existingPteroUser;
            pterodactylPasswordForEmail = "Please use your existing Pterodactyl password for this email. If forgotten, you can reset it on the Pterodactyl login page.";
            if (!siteUser.pterodactylUserId || siteUser.pterodactylUserId !== existingPteroUser.id) {
                siteUser.pterodactylUserId = existingPteroUser.id;
                siteUser.pterodactylUsername = existingPteroUser.username;
                await siteUser.save();
            }
        }

        const resourceConfig = RESOURCE_MAP[order.productPrice];
        if (!resourceConfig) {
            await sendEmail(process.env.ADMIN_EMAIL, `Order Approval Issue ${order._id}`, `No resource map for price ${order.productPrice}.`);
            return res.status(400).json({ message: `Resource config not found for price: ${order.productPrice}` });
        }
        
        if (resourceConfig.is_reseller || resourceConfig.is_admin) {
            order.status = 'approved';
            order.adminNotes = "Reseller/Admin panel: manual Pterodactyl setup needed.";
            order.approvedAt = new Date();
            await order.save();
            const resellerHtml = `
                <h1>Your Order is Approved!</h1>
                <p>Hi ${siteUser.firstName},</p>
                <p>Your order for <strong>${order.productName} (${order.productPriceFormatted})</strong> has been approved.</p>
                <p>For Reseller/Admin panels, setup is manual. Our team will contact you with access details for Pterodactyl using email: <strong>${pteroUserEmail}</strong>.</p>
                <p>Panel URL: <a href="${process.env.PTERODACTYL_DOMAIN}">${process.env.PTERODACTYL_DOMAIN}</a></p>
                <p>Thanks,<br>Gxyenn Store Team</p>`;
            await sendEmail(pteroUserEmail, `Order Approved: ${order.productName}`, resellerHtml);
            return res.status(200).json({ message: 'Reseller/Admin order approved. Manual setup needed.' });
        }

        const serverName = `Gxyenn-${siteUser.firstName.replace(/\s/g, '')}-${order.productName.substring(0,10).replace(/\s/g, '')}-${uuidv4().substring(0,4)}`;
        
        if (!pteroUserAttributes || !pteroUserAttributes.id) {
            await sendEmail(process.env.ADMIN_EMAIL, `Ptero User ID Missing Order ${order._id}`, `No Ptero user ID for ${pteroUserEmail}.`);
            return res.status(500).json({ message: 'Failed to resolve Pterodactyl user ID.' });
        }

        const pterodactylServer = await createPterodactylServer(pteroUserAttributes.id, serverName, resourceConfig);

        if (!pterodactylServer || !pterodactylServer.id) {
             await sendEmail(process.env.ADMIN_EMAIL, `Ptero Server Creation FAILED Order ${order._id}`, `Failed for user ${pteroUserEmail}. Response: ${JSON.stringify(pterodactylServer)}`);
            return res.status(500).json({ message: 'Failed to create Pterodactyl server.' });
        }

        order.status = 'approved';
        order.pterodactylServerId = pterodactylServer.id;
        order.approvedAt = new Date();
        await order.save();

        const approvalHtml = `
            <h1>Your Order is Approved & Panel is Ready!</h1>
            <p>Hi ${siteUser.firstName},</p>
            <p>Your order for <strong>${order.productName} (${order.productPriceFormatted})</strong> has been approved.</p>
            <p>Panel URL: <a href="${process.env.PTERODACTYL_DOMAIN}">${process.env.PTERODACTYL_DOMAIN}</a></p>
            <p>Your Pterodactyl login email: <strong>${pteroUserEmail}</strong></p>
            <p>Your Pterodactyl password: <strong>${pterodactylPasswordForEmail}</strong></p>
            ${(pteroUserAttributes && pteroUserAttributes.plainPassword) ? "<p>(This is a newly generated password. Please change it after your first login on Pterodactyl.)</p>" : ""}
            <p>Server Name: ${pterodactylServer.name}</p>
            <p>Thanks,<br>Gxyenn Store Team</p>`;
        await sendEmail(pteroUserEmail, `Order Approved & Panel Ready: ${order.productName}`, approvalHtml);
        res.status(200).json({ message: 'Order approved, Pterodactyl setup done, user notified.', order });
    } catch (error) {
        console.error(`Error approving order ${orderId}:`, error.response ? error.response.data : error);
        await sendEmail(process.env.ADMIN_EMAIL, `Order Approval FAILED ${orderId}`, `Error: ${error.message}.`);
        res.status(500).json({ message: 'Server error approving order.' });
    }
});

app.get('/api/admin/orders', adminOnlyMiddleware, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const statusFilter = req.query.status;

        let query = {};
        if (statusFilter) query.status = statusFilter;

        const orders = await Order.find(query)
            .populate('user', 'email firstName lastName')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        
        const totalOrders = await Order.countDocuments(query);
        
        res.json({
            orders,
            currentPage: page,
            totalPages: Math.ceil(totalOrders / limit),
            totalOrders
        });
    } catch (error) {
        console.error('Error fetching admin orders:', error);
        res.status(500).json({ message: 'Server error fetching orders for admin.' });
    }
});

app.get('/api/orders/my', async (req, res) => {
    if (!req.user) return res.status(401).json({ message: 'Not authorized. Please login.' });
    try {
        const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 });
        res.json(orders);
    } catch (error) {
        console.error('Error fetching user orders:', error);
        res.status(500).json({ message: 'Server error fetching orders.' });
    }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'register.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
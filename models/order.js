const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    productName: {
        type: String,
        required: true
    },
    productPrice: { // Store the numeric price used for resource calculation
        type: Number,
        required: true
    },
    productPriceFormatted: { // Store the display string like "Rp 1.000/Bulan"
        type: String,
        required: true
    },
    transactionId: {
        type: String,
        trim: true
    },
    paymentProofPath: {
        type: String
        // required: true // Not strictly required if admin can approve without it in some cases
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    pterodactylServerId: {
        type: Number,
        unique: true,
        sparse: true
    },
    notesToAdmin: {
        type: String
    },
    adminNotes: { // Notes from admin to user or for record
        type: String
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    approvedAt: {
        type: Date
    }
});

module.exports = mongoose.model('Order', orderSchema);
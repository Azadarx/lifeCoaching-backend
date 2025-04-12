// server.js (ES Module version)
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import Razorpay from 'razorpay';
import path from 'path';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';

// Setup __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config();

// Check Razorpay credentials
if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_SECRET) {
  console.error('❌ RAZORPAY_KEY_ID or RAZORPAY_SECRET is missing in .env');
  process.exit(1);
}

// Check Email credentials
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
  console.error('⚠️ EMAIL_USER or EMAIL_PASSWORD is missing in .env, emails will not be sent');
}

// Initialize Express
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_SECRET
});

// Configure nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// Verify email transport connection
transporter.verify(function (error, success) {
  if (error) {
    console.error('❌ SMTP connection error:', error);
  } else {
    console.log('✅ SMTP server is ready to take our messages');
  }
});

// ADD THIS ENDPOINT: API to get Razorpay key
app.get('/api/razorpay-key', (req, res) => {
  res.json({ key_id: process.env.RAZORPAY_KEY_ID });
});

// API: Create Razorpay Order
app.post(`${import.meta.env.VITE_BACKEND_URL}/api/create-order`, async (req, res) => {
  try {
    const { amount, currency, receipt, customerDetails, cartItems } = req.body;

    // Log order creation attempt
    console.log('📝 Creating order:', { amount, currency, receipt });

    const options = {
      amount,
      currency,
      receipt,
      notes: {
        customerName: customerDetails.fullName,
        customerEmail: customerDetails.email,
        customerPhone: customerDetails.phone
      }
    };

    const order = await razorpay.orders.create(options);
    console.log('✅ Order created successfully:', order.id);
    res.json(order);
  } catch (error) {
    console.error('❌ Order creation failed:', error);
    res.status(500).json({ error: 'Failed to create order', details: error.message });
  }
});

// API: Handle payment success
app.post(`${import.meta.env.VITE_BACKEND_URL}/api/payment-success`, async (req, res) => {
  try {
    const {
      razorpayPaymentId,
      razorpayOrderId,
      razorpaySignature,
      customerDetails,
      cartItems,
      amount
    } = req.body;

    console.log('💰 Payment success callback received:', { 
      paymentId: razorpayPaymentId,
      orderId: razorpayOrderId
    });

    // Verify signature
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    if (generatedSignature !== razorpaySignature) {
      console.error('❌ Invalid signature');
      return res.status(400).json({ success: false, message: 'Invalid signature' });
    }

    // Format cart items for email if available
    let cartItemsHtml = '';
    if (cartItems && cartItems.length > 0) {
      cartItemsHtml = `
        <h3 style="margin-top: 20px; color: #8e44ad;">Items Purchased:</h3>
        <ul style="padding-left: 20px;">
          ${cartItems.map(item => `
            <li>
              <strong>${item.title || item.name}</strong> - 
              ₹${item.price} ${item.quantity ? `x ${item.quantity}` : ''}
            </li>
          `).join('')}
        </ul>
      `;
    }

    // Email to customer
    const mailOptions = {
      from: `"Mrs. Shereen Life Coaching" <${process.env.EMAIL_USER}>`,
      to: customerDetails.email,
      subject: 'Booking Confirmation - Mrs. Shereen Life Coaching',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #8e44ad;">Thank you for your booking!</h2>
          <p>Dear ${customerDetails.fullName},</p>
          <p>We are pleased to confirm your booking with Mrs. Shereen Life Coaching.</p>
          <div style="background-color: #f8f4ff; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #8e44ad;">Booking Details:</h3>
            <p><strong>Amount Paid:</strong> ₹${(amount).toFixed(2)}</p>
            <p><strong>Transaction ID:</strong> ${razorpayPaymentId}</p>
            ${cartItemsHtml}
          </div>
          <p>Mrs. Shereen will contact you within 24 hours on your provided phone number to schedule your session.</p>
          <p>Warm regards,<br>The Mrs. Shereen Life Coaching Team</p>
        </div>
      `
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log('✉️ Customer email sent to:', customerDetails.email);
    } catch (emailError) {
      console.error('❌ Failed to send customer email:', emailError);
    }

    // Email to admin
    const adminMailOptions = {
      from: `"Mrs. Shereen Booking System" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
      subject: 'New Booking Alert - Life Coaching',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #8e44ad;">New Booking Received!</h2>
          <div style="background-color: #f8f4ff; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Name:</strong> ${customerDetails.fullName}</p>
            <p><strong>Email:</strong> ${customerDetails.email}</p>
            <p><strong>Phone:</strong> ${customerDetails.phone}</p>
            <p><strong>Amount Paid:</strong> ₹${(amount).toFixed(2)}</p>
            <p><strong>Transaction ID:</strong> ${razorpayPaymentId}</p>
            ${cartItemsHtml}
          </div>
          <p>Please contact the customer within 24 hours to schedule their session.</p>
        </div>
      `
    };

    try {
      await transporter.sendMail(adminMailOptions);
      console.log('✉️ Admin notification email sent');
    } catch (emailError) {
      console.error('❌ Failed to send admin email:', emailError);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Payment verification failed:', error);
    res.status(500).json({ success: false, error: 'Payment verification failed', details: error.message });
  }
});

// Serve React app if build exists
const buildPath = path.join(__dirname, 'build');
if (fs.existsSync(buildPath)) {
  app.use(express.static(buildPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(buildPath, 'index.html'));
  });
} else {
  console.warn('⚠️  Build folder not found. React frontend not served.');
}
// Add this new endpoint to your server.js file

// API: Handle contact form submissions
app.post(`${import.meta.env.VITE_BACKEND_URL}/api/contact`, async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;
    
    console.log('📝 Contact form submission received:', { name, email, subject });
    
    // Email to admin
    const contactMailOptions = {
      from: `"Contact Form" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
      subject: `New Contact Form: ${subject}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #8e44ad;">New Contact Form Submission</h2>
          <div style="background-color: #f8f4ff; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Subject:</strong> ${subject}</p>
            <p><strong>Message:</strong></p>
            <div style="background-color: white; padding: 15px; border-radius: 5px;">
              ${message.replace(/\n/g, '<br>')}
            </div>
          </div>
        </div>
      `
    };
    
    // Optional: Send confirmation email to the user
    const userConfirmationOptions = {
      from: `"Mrs. Shereen Life Coaching" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Thank You for Contacting Mrs. Shereen',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #8e44ad;">Thank You for Your Message</h2>
          <p>Dear ${name},</p>
          <p>Thank you for reaching out to Mrs. Shereen Life Coaching. I have received your message and will get back to you shortly.</p>
          <p>Here's a copy of your message:</p>
          <div style="background-color: #f8f4ff; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Subject:</strong> ${subject}</p>
            <p><strong>Message:</strong></p>
            <div style="background-color: white; padding: 15px; border-radius: 5px;">
              ${message.replace(/\n/g, '<br>')}
            </div>
          </div>
          <p>Warm regards,<br>Mrs. Shereen</p>
        </div>
      `
    };

    // Send email to admin
    await transporter.sendMail(contactMailOptions);
    console.log('✉️ Contact form email sent to admin');
    
    // Send confirmation to user
    await transporter.sendMail(userConfirmationOptions);
    console.log('✉️ Confirmation email sent to user:', email);

    res.json({ success: true, message: 'Message sent successfully!' });
  } catch (error) {
    console.error('❌ Failed to process contact form:', error);
    res.status(500).json({ success: false, message: 'Failed to send message', details: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔑 Razorpay configured with key: ${process.env.RAZORPAY_KEY_ID.substring(0, 10)}...`);
  console.log(`📧 Email configured with: ${process.env.EMAIL_USER}`);
});
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

/* ================================
   MIDDLEWARE
================================ */

app.use(cors({
  origin: "*", // later restrict to your domain
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

const PORT = process.env.PORT || 3000;

console.log("SERVER STARTING...");

/* ================================
   ENV VARIABLES
================================ */

const BOTBIZ_API_URL = "https://dash.botbiz.io/api/v1/whatsapp/send/template";
const BOTBIZ_API_TOKEN = process.env.BOTBIZ_API_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const TEMPLATE_ID = process.env.TEMPLATE_ID;

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN;

/* ================================
   TEMP OTP STORE (in-memory)
================================ */

const otpStore = {};

/* ================================
   ROOT CHECK
================================ */

app.get("/", (req, res) => {
  res.send("OTP BACKEND LIVE");
});

/* ================================
   TEST SHOPIFY CONNECTION
================================ */

app.get("/test-shopify", async (req, res) => {
  try {
    const response = await axios.get(
      `https://${SHOPIFY_STORE}/admin/api/2026-01/shop.json`,
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_TOKEN,
          "Content-Type": "application/json"
        }
      }
    );

    res.json(response.data);

  } catch (error) {
    console.log("SHOPIFY ERROR:", error.response?.data || error.message);
    res.status(500).json({ error: "Shopify connection failed" });
  }
});

/* ================================
   SEND OTP
================================ */

app.post("/send-otp", async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ error: "Phone required" });
    }

    const cleanPhone = phone.replace(/\+/g, "").replace(/\s/g, "");

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    otpStore[cleanPhone] = {
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000
    };

    const params = new URLSearchParams();
    params.append("apiToken", BOTBIZ_API_TOKEN);
    params.append("phone_number_id", PHONE_NUMBER_ID);
    params.append("template_id", TEMPLATE_ID);
    params.append("templateVariable-1-1", otp);
    params.append("phone_number", cleanPhone);

    await axios.post(BOTBIZ_API_URL, params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });

    res.json({ success: true });

  } catch (error) {
    console.log("BOTBIZ ERROR:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to send OTP" });
  }
});

/* ================================
   VERIFY OTP + CREATE CUSTOMER
================================ */

app.post("/verify-otp", async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ error: "Phone and OTP required" });
    }

    const cleanPhone = phone.replace(/\+/g, "").replace(/\s/g, "");
    const record = otpStore[cleanPhone];

    if (!record) {
      return res.status(400).json({ error: "No OTP found" });
    }

    if (Date.now() > record.expiresAt) {
      delete otpStore[cleanPhone];
      return res.status(400).json({ error: "OTP expired" });
    }

    if (record.otp !== otp) {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    delete otpStore[cleanPhone];

    // 1️⃣ Check if customer exists
    const search = await axios.get(
      `https://${SHOPIFY_STORE}/admin/api/2026-01/customers/search.json?query=phone:+${cleanPhone}`,
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_TOKEN,
          "Content-Type": "application/json"
        }
      }
    );

    if (search.data.customers.length > 0) {
      return res.json({ success: true, message: "Customer exists" });
    }

    // 2️⃣ Create new customer
    await axios.post(
      `https://${SHOPIFY_STORE}/admin/api/2026-01/customers.json`,
      {
        customer: {
          phone: "+" + cleanPhone,
          verified_email: false,
          tags: "otp-user"
        }
      },
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_TOKEN,
          "Content-Type": "application/json"
        }
      }
    );

    return res.json({ success: true, message: "Customer created" });

  } catch (error) {
    console.log("VERIFY ERROR:", error.response?.data || error.message);
    return res.status(500).json({ error: "Verification failed" });
  }
});

/* ================================
   START SERVER
================================ */

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

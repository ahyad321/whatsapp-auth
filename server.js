const express = require("express");
const axios = require("axios");
const cors = require("cors");
const jwt = require("jsonwebtoken");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;



const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

const BOTBIZ_API_URL = process.env.BOTBIZ_API_URL;
const BOTBIZ_API_TOKEN = process.env.BOTBIZ_API_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const TEMPLATE_ID = process.env.TEMPLATE_ID;

const JWT_SECRET = process.env.JWT_SECRET;

/* =============================== */

const otpStore = {};

/* ===============================
   ROOT CHECK
================================= */

app.get("/", (req, res) => {
  res.send("OTP BACKEND LIVE");
});

/* ===============================
   SEND OTP
================================= */

app.post("/send-otp", async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: "Phone required" });

    const cleanPhone = phone.replace(/\D/g, "");
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

  } catch (err) {
    console.log("SEND OTP ERROR:", err.response?.data || err.message);
    res.status(500).json({ error: "OTP send failed" });
  }
});

/* ===============================
   VERIFY OTP + CUSTOMER RESOLUTION
================================= */

app.post("/verify-otp", async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp)
      return res.status(400).json({ error: "Phone & OTP required" });

    const cleanPhone = phone.replace(/\D/g, "");
    const record = otpStore[cleanPhone];

    if (!record)
      return res.status(400).json({ error: "No OTP found" });

    if (Date.now() > record.expiresAt)
      return res.status(400).json({ error: "OTP expired" });

    if (record.otp !== otp)
      return res.status(400).json({ error: "Invalid OTP" });

    let customer = null;

    // Use generated email for stable identity
    const generatedEmail = `${cleanPhone}@whatsapp.login`;

    /* ============================
       SEARCH BY EMAIL (RELIABLE)
    ============================= */

    const search = await axios.get(
      `https://${SHOPIFY_STORE}/admin/api/2026-01/customers/search.json?query=email:${generatedEmail}`,
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN
        }
      }
    );

    if (search.data.customers.length > 0) {
      customer = search.data.customers[0];
    }

    /* ============================
       CREATE IF NOT EXISTS
    ============================= */

    if (!customer) {
      const create = await axios.post(
        `https://${SHOPIFY_STORE}/admin/api/2026-01/customers.json`,
        {
          customer: {
            email: generatedEmail,
            phone: "+" + cleanPhone,
            tags: "whatsapp_auth"
          }
        },
        {
          headers: {
            "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN
          }
        }
      );

      customer = create.data.customer;
    }

    if (!customer)
      return res.status(500).json({ error: "Customer resolution failed" });

    /* ============================
       GENERATE JWT SESSION
    ============================= */

    const token = jwt.sign(
      {
        customer_id: customer.id,
        phone: cleanPhone
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    delete otpStore[cleanPhone];

    res.json({
      success: true,
      token
    });

  } catch (err) {
    console.log("VERIFY ERROR:", err.response?.data || err.message);
    res.status(500).json({ error: "Verification failed" });
  }
});

/* ===============================
   PROTECTED ROUTE
================================= */

app.get("/me", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader)
      return res.status(401).json({ error: "No token provided" });

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const response = await axios.get(
      `https://${SHOPIFY_STORE}/admin/api/2026-01/customers/${decoded.customer_id}.json`,
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN
        }
      }
    );

    res.json(response.data.customer);

  } catch (err) {
    res.status(401).json({ error: "Invalid session" });
  }
});

/* =============================== */

app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});

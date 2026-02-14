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

    const generatedEmail = `${cleanPhone}@whatsapp.login`;

    // Search by email instead (RELIABLE)
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

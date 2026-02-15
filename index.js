const express = require("express");
const cors = require("cors");
const { MercadoPagoConfig, Preference } = require("mercadopago");
const nodemailer = require("nodemailer");
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(express.json());
app.use(cors());

// 1. Configuración de Mercado Pago
const client = new MercadoPagoConfig({ 
  accessToken: "APP_USR-5718871151573243-021417-1d7e37013b7e3a90075d5d2a77709653-310958737" 
});

// 2. Configuración de Nodemailer (Correos)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "housereconquista@gmail.com",
    pass: "sdvcldsouxffmtut" 
  }
});

const enviarMailConfirmacion = async (emailCliente, nombre, habitacion, monto) => {
  const mailOptions = {
    from: '"Casa Reconquista" <housereconquista@gmail.com>',
    to: `housereconquista@gmail.com, ${emailCliente}`,
    subject: `✅ Reserva Confirmada - ${habitacion}`,
    html: `
      <div style="font-family: Arial, sans-serif; border: 1px solid #ddd; padding: 20px;">
        <h2 style="color: #2d3436;">¡Reserva Exitosa!</h2>
        <p>Hola <strong>${nombre}</strong>, hemos recibido tu pago correctamente.</p>
        <hr>
        <p><strong>Detalles:</strong></p>
        <ul>
          <li><strong>Concepto:</strong> ${habitacion}</li>
          <li><strong>Monto recibido:</strong> $${monto} (ARS)</li>
        </ul>
        <p>Este correo sirve como comprobante de tu reserva.</p>
      </div>
    `
  };
  return transporter.sendMail(mailOptions);
};

// 3. Ruta para crear la preferencia
app.post("/create_preference", async (req, res) => {
  try {
    const { amountInUSD, description, customer } = req.body;
    const responseDolar = await fetch("https://dolarapi.com/v1/dolares/blue");
    const datosDolar = await responseDolar.json();
    const cotizacion = datosDolar.compra; 
    const amountInARS = Math.round(amountInUSD * cotizacion);

    const preference = new Preference(client);
    const result = await preference.create({
      body: {
        items: [{ title: description, quantity: 1, unit_price: amountInARS, currency_id: "ARS" }],
        payer: { email: customer.email, name: customer.name },
        back_urls: {
          success: "https://tupagina-en-netlify.netlify.app", // Reemplaza por tu link de Netlify
          failure: "https://tupagina-en-netlify.netlify.app",
        },
        auto_return: "approved",
        // URL de tu servidor en Render para que MP te avise del pago
        notification_url: "https://servidor-housecheconquista.onrender.com/webhook" 
      },
    });

    res.json({ init_point: result.init_point });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// 4. Webhook: Detecta el pago y manda el mail
app.post("/webhook", async (req, res) => {
  const { query } = req;
  const topic = query.topic || query.type;

  if (topic === "payment") {
    const paymentId = query.id || query['data.id'];
    try {
      const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer APP_USR-5718871151573243-021417-1d7e37013b7e3a90075d5d2a77709653-310958737` }
      });
      const data = await response.json();

      if (data.status === "approved") {
        await enviarMailConfirmacion(
          data.payer.email, 
          "Huésped", 
          data.description, 
          data.transaction_amount
        );
      }
    } catch (err) { console.error("Error Webhook:", err); }
  }
  res.sendStatus(200);
});

app.listen(3001, () => { console.log("🚀 Servidor en la nube listo"); });
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
    pass: "sdvcldsouxffmtut" // El código que te pasó tu hermana
  }
});

// Función para enviar correos
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
        <p><strong>Detalles de la estancia:</strong></p>
        <ul>
          <li><strong>Habitación:</strong> ${habitacion}</li>
          <li><strong>Monto de la seña:</strong> $${monto} (ARS)</li>
        </ul>
        <p>¡Nos vemos pronto en Casa Reconquista!</p>
      </div>
    `
  };
  return transporter.sendMail(mailOptions);
};

// 3. Ruta para crear la preferencia (Botón de pago)
app.post("/create_preference", async (req, res) => {
  try {
    const { amountInUSD, description } = req.body;
    const responseDolar = await fetch("https://dolarapi.com/v1/dolares/blue");
    const datosDolar = await responseDolar.json();
    const cotizacion = datosDolar.compra; 
    const amountInARS = Math.round(amountInUSD * cotizacion);

    const preference = new Preference(client);
    const result = await preference.create({
      body: {
        items: [{ title: description, quantity: 1, unit_price: amountInARS, currency_id: "ARS" }],
        back_urls: {
          success: "http://localhost:5173", // Luego cambiaremos esto por la web real
          failure: "http://localhost:5173",
          pending: "http://localhost:5173"
        },
        auto_return: "approved",
        // Aquí es donde Mercado Pago avisará del pago:
        notification_url: "TU_URL_DE_RENDER_VA_AQUÍ/webhook" 
      },
    });

    res.json({ init_point: result.init_point });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// 4. EL WEBHOOK: Donde ocurre la magia
app.post("/webhook", async (req, res) => {
  const { query } = req;
  const topic = query.topic || query.type;

  if (topic === "payment") {
    const paymentId = query.id || query['data.id'];
    console.log("💰 Pago recibido, ID:", paymentId);
    
    // Aquí es donde mandaremos el mail una vez que verifiquemos el pago.
    // Por ahora enviamos un OK a Mercado Pago para que no siga reintentando.
  }
  res.sendStatus(200);
});

app.listen(3001, () => {
  console.log("🚀 Servidor con correos listo en puerto 3001");
});
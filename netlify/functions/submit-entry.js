const fetch = require('node-fetch');
const FormData = require('form-data');
const { parseMultipartForm } = require('./parse-multipart');

// Environment variables - set these in Netlify dashboard
const DISCORD_WEBHOOKS = process.env.DISCORD_WEBHOOKS ? process.env.DISCORD_WEBHOOKS.split(',') : [];
const IMGBB_API_KEY = process.env.IMGBB_API_KEY || '';
const EMBED_COLOR = process.env.EMBED_COLOR || '#596D69';
const AVATAR_IMAGE = process.env.AVATAR_IMAGE || 'https://i.imgur.com/9aiqU0r.png';
const FORM_LINK = process.env.FORM_LINK || '';

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Parse multipart form data
    const { fields, files } = await parseMultipartForm(event);

    // Validate required fields
    if (!fields.inGameName || !fields.clan || !fields.warframe) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    // Validate arsenal image
    if (!files.arsenalImage) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Arsenal screenshot is required' })
      };
    }

    // Upload images to imgbb
    const imageUrls = [];
    
    // Upload captura images
    for (let i = 0; i < 5; i++) {
      const capturaFile = files[`capturaImage${i}`];
      if (capturaFile) {
        try {
          const url = await uploadToImgbb(capturaFile);
          imageUrls.push(url);
        } catch (error) {
          console.error(`Failed to upload captura image ${i}:`, error);
        }
      }
    }

    // Upload arsenal image
    const arsenalUrl = await uploadToImgbb(files.arsenalImage);

    // Get submission count from environment or default
    let submissionCount = parseInt(process.env.SUBMISSION_COUNT || '0') + 1;

    // Build Discord payload
    const payload = buildDiscordPayload(fields, imageUrls, arsenalUrl, submissionCount);

    // Send to all Discord webhooks
    const results = await sendToWebhooks(payload);

    if (results.successCount > 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          success: true, 
          message: `Entry submitted to ${results.successCount} server(s)` 
        })
      };
    } else {
      throw new Error('All webhooks failed');
    }

  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Submission failed' })
    };
  }
};

// Upload image to imgbb
async function uploadToImgbb(file) {
  if (!IMGBB_API_KEY) {
    throw new Error('IMGBB_API_KEY not configured');
  }

  const formData = new FormData();
  formData.append('image', file.content, {
    filename: file.filename,
    contentType: file.contentType
  });

  const response = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    throw new Error(`Image upload failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data.url;
}

// Build Discord embed payload
function buildDiscordPayload(fields, capturaUrls, arsenalUrl, submissionNum) {
  const capturaCount = capturaUrls.length;
  const capturaText = capturaCount > 0 
    ? `📸 ${capturaCount} Captura image${capturaCount > 1 ? 's' : ''} uploaded`
    : '';

  const fieldsText = [
    capturaText && capturaText,
    `**Arsenal Screenshot**\n⚔️ Image uploaded`,
    `**In-Game Name:**\n${fields.inGameName}`,
    `**Clan:**\n${fields.clan}`,
    `**Warframe:**\n${fields.warframe}`,
    fields.notes && fields.notes.trim() ? `**Submission Details:**\n${fields.notes}` : null
  ].filter(Boolean).join('\n\n');

  const embed = {
    title: "Sanctum Aeterna Alliance Event",
    color: parseInt(EMBED_COLOR.replace('#', ''), 16),
    description: `New contest entry received!\n\n${fieldsText}${FORM_LINK ? `\n\n📝 **[Click here to submit your entry!](${FORM_LINK})**` : ''}`,
    timestamp: new Date().toISOString(),
    footer: {
      text: `Submission #${submissionNum}`
    }
  };

  if (AVATAR_IMAGE) {
    embed.thumbnail = { url: AVATAR_IMAGE };
  }

  // Add arsenal image to main embed
  if (arsenalUrl) {
    embed.image = { url: arsenalUrl };
  }

  const payload = {
    content: " ",
    embeds: [embed]
  };

  // Add captura images as separate embeds
  for (let i = 0; i < capturaUrls.length && i < 9; i++) {
    payload.embeds.push({
      url: "https://discord.com",
      image: { url: capturaUrls[i] }
    });
  }

  return payload;
}

// Send to all Discord webhooks
async function sendToWebhooks(payload) {
  if (DISCORD_WEBHOOKS.length === 0) {
    throw new Error('No Discord webhooks configured');
  }

  let successCount = 0;
  let errorCount = 0;

  const promises = DISCORD_WEBHOOKS.map(async (webhook) => {
    try {
      const response = await fetch(webhook.trim(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        successCount++;
      } else {
        errorCount++;
        console.error('Webhook failed:', response.status);
      }
    } catch (error) {
      errorCount++;
      console.error('Webhook error:', error);
    }
  });

  await Promise.all(promises);
  return { successCount, errorCount };
}

const { Readable } = require('stream');
const Busboy = require('busboy');

async function parseMultipartForm(event) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const files = {};

    const contentType = event.headers['content-type'] || event.headers['Content-Type'];
    
    const busboy = Busboy({ 
      headers: { 
        'content-type': contentType 
      }
    });

    busboy.on('field', (fieldname, value) => {
      fields[fieldname] = value;
    });

    busboy.on('file', (fieldname, file, info) => {
      const { filename, encoding, mimeType } = info;
      const buffers = [];

      file.on('data', (data) => {
        buffers.push(data);
      });

      file.on('end', () => {
        files[fieldname] = {
          filename: filename,
          contentType: mimeType,
          content: Buffer.concat(buffers)
        };
      });
    });

    busboy.on('finish', () => {
      resolve({ fields, files });
    });

    busboy.on('error', (error) => {
      reject(error);
    });

    // Convert base64 body to buffer and pipe to busboy
    const bodyBuffer = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
    const stream = Readable.from(bodyBuffer);
    stream.pipe(busboy);
  });
}

module.exports = { parseMultipartForm };

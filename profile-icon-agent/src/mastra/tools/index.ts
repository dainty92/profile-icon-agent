import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import axios from 'axios';
import sharp from 'sharp';
import cloudinary from 'cloudinary';

// Load credentials securely from environment variables
const apiKey = process.env.IMAGGA_API_KEY || '';
const apiSecret = process.env.IMAGGA_API_SECRET || '';
const TELEX_WEBHOOK_URL = process.env.TELEX_WEBHOOK_URL || '';

// Configure Cloudinary
cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Validate if an uploaded image is in JPG or PNG format
function validateImageFormat(photoUrl: string): boolean {
  return /\.(jpg|jpeg|png)$/i.test(photoUrl);
}

// Function to detect faces in an image using Imagga API
async function detectFaceWithPadding(photoUrl: string, padding: number = 40) {
  if (!validateImageFormat(photoUrl)) {
    throw new Error('Invalid image format. Please upload a JPG or PNG file.');
  }

  const apiUrl = `https://api.imagga.com/v2/faces/detections?image_url=${encodeURIComponent(photoUrl)}`;
  try {
    const response = await axios.get(apiUrl, {
      auth: { username: apiKey, password: apiSecret },
    });

    const faces = response.data.result.faces;
    if (!faces || faces.length === 0) {
      throw new Error('No face detected in the image.');
    }

    // Process the largest detected face (assuming first face is the most prominent)
    const face = faces[0];
    const { coordinates } = face;

    if (!coordinates || coordinates.xmin === undefined || coordinates.ymin === undefined) {
      throw new Error('Invalid face detection coordinates received from Imagga.');
    }

    return { coordinates, padding };
  } catch (error: any) {
    console.error('Face detection failed:', error.message);
    throw new Error('Face detection service unavailable. Try again later.');
  }
}

// Function to upload the image to Cloudinary
async function uploadToCloudinary(imageBuffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.v2.uploader.upload_stream(
      { resource_type: 'image', folder: 'profile_icons' },
      (error, result) => {
        if (error || !result?.secure_url) {
          return reject(new Error('Cloudinary upload failed.'));
        }
        resolve(result.secure_url);
      }
    );
    uploadStream.end(imageBuffer);
  });
}

// Function to apply different styles
async function applyStyle(imageBuffer: Buffer, style: string): Promise<Buffer> {
  let editedImage = sharp(imageBuffer);

  switch (style) {
    case 'Cool':
      editedImage = editedImage.modulate({ brightness: 1.2, saturation: 1.5 });
      break;
    case 'Professional':
      editedImage = editedImage.grayscale().sharpen();
      break;
    case 'Artistic':
      editedImage = editedImage.tint({ r: 255, g: 127, b: 80 }); // Warm artistic tint
      break;
    default:
      break;
  }

  return editedImage.jpeg({ quality: 90 }).toBuffer();
}

// Function to process the image (crop, resize, apply style)
async function processProfileImage(photoUrl: string, faceData: any, style: string) {
  const { coordinates, padding } = faceData;

  try {
    // Download image
    const imageResponse = await axios.get(photoUrl, { responseType: 'arraybuffer' });
    let imageBuffer = Buffer.from(imageResponse.data, 'binary');

    // Get image metadata
    const metadata = await sharp(imageBuffer).metadata();
    const imageWidth = metadata.width || 0;
    const imageHeight = metadata.height || 0;

    // Compute cropping dimensions
    let x = Math.max(coordinates.xmin - padding, 0);
    let y = Math.max(coordinates.ymin - padding, 0);
    let width = coordinates.xmax - coordinates.xmin + 2 * padding;
    let height = coordinates.ymax - coordinates.ymin + 2 * padding;

    // Ensure within image boundaries
    width = Math.min(width, imageWidth - x);
    height = Math.min(height, imageHeight - y);

    // Determine max dimension for square crop
    const maxDimension = Math.max(width, height);

    // Crop & resize image
    imageBuffer = await sharp(imageBuffer)
      .extract({ left: x, top: y, width, height })
      .resize(maxDimension, maxDimension, { fit: 'cover' })
      .toBuffer();

    // Apply selected style
    imageBuffer = await applyStyle(imageBuffer, style);

    // Upload processed image to Cloudinary
    return await uploadToCloudinary(imageBuffer);
  } catch (error: any) {
    console.error('Error processing the image:', error.message);
    throw new Error('Image processing failed.');
  }
}

// Function to send the generated headshot to Telex
async function sendTelexHeadshot(headshotUrl: string) {
  if (!TELEX_WEBHOOK_URL) {
    console.error("❌ Telex Webhook URL is missing!");
    return;
  }

  const payload = {
    event_name: "Profile Icon Ready",
    username: "EstherBot",
    status: "success",
    message: `🎨 Your AI-generated profile icon is ready!\n\n[Click here to view](${headshotUrl})`
  };

  try {
        const response = await axios.post(TELEX_WEBHOOK_URL, payload, {
            headers: { "Content-Type": "application/json" }
        });
        console.log("✅ Telex Headshot Sent:", response.data);
    } catch (error: any) {
        console.error('Error sending Telex message:', error.message);
  }
}

// Mastra tool integration for headshot generation
export const profileIconTool = createTool({
  id: 'generate-headshot',
  description: 'Generate a cropped headshot with style options',
  inputSchema: z.object({
    photoUrl: z.string().describe('URL of the uploaded image file'),
    style: z.enum(["Cool", "Professional", "Artistic"]).default("Cool"),
  }),
  outputSchema: z.object({
    headshotUrl: z.string(),
    message: z.string(),
  }),
  execute: async ({ context }) => {
    const { photoUrl, style } = context;

    try {
      // Detect face
      const faceData = await detectFaceWithPadding(photoUrl);

      // Process image
      const headshotUrl = await processProfileImage(photoUrl, faceData, style);

      // Send to Telex
      await sendTelexHeadshot(headshotUrl);

      return {
        headshotUrl: headshotUrl,
        message: `Profile icon with '${style}' style processed successfully!`,
      };
    } catch (error: any) {
      console.error('Error processing the image:', error.message);
      throw new Error(`Failed to process the image: ${error.message}`);
    }
  },
});

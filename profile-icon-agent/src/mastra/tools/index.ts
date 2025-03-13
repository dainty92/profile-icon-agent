import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import axios from 'axios';
import sharp from 'sharp';
import cloudinary from 'cloudinary';

// Imagga API credentials
const apiKey = 'acc_709326036b0cbea';
const apiSecret = 'e053ca0c7833ad01a5235cf002dd3e4f';

const TELEX_WEBHOOK_URL = process.env.TELEX_WEBHOOK_URL;

// Configure Cloudinary
cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Function to detect face using Imagga API
async function detectFaceWithPadding(photoUrl: string, padding: number = 40) {
  const apiUrl = `https://api.imagga.com/v2/faces/detections?image_url=${encodeURIComponent(photoUrl)}`;

  const response = await axios.get(apiUrl, {
    auth: {
      username: apiKey,
      password: apiSecret,
    },
  });

  const faces = response.data.result.faces;
  if (!faces || faces.length === 0) {
    throw new Error('No face detected in the image');
  }

  const face = faces[0];
  const { coordinates } = face;

  if (
    coordinates.xmin === undefined || coordinates.ymin === undefined ||
    coordinates.xmax === undefined || coordinates.ymax === undefined
  ) {
    throw new Error('Invalid face detection coordinates received from Imagga');
  }

  return { coordinates, padding };
}

// Function to upload the image to Cloudinary
async function uploadToCloudinary(imageBuffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.v2.uploader.upload_stream(
      { resource_type: 'image', folder: 'profile_icons' },
      (error, result) => {
        if (error || !result?.secure_url) {
          return reject(new Error('Cloudinary upload failed'));
        }
        resolve(result.secure_url);
      }
    );

    uploadStream.end(imageBuffer);
  });
}

// Function to process image
async function cropAndUploadFaceImage(photoUrl: string, faceData: { coordinates: any, padding: number }) {
  const { coordinates, padding } = faceData;

  // Download image
  const imageResponse = await axios.get(photoUrl, { responseType: 'arraybuffer' });
  const imageBuffer = Buffer.from(imageResponse.data, 'binary');

  // Get image metadata
  const metadata = await sharp(imageBuffer).metadata();
  const imageWidth = metadata.width || 0;
  const imageHeight = metadata.height || 0;

  if (!imageWidth || !imageHeight) {
    throw new Error('Unable to retrieve image dimensions');
  }

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

  // Process image
  const processedImage = await sharp(imageBuffer)
    .extract({ left: x, top: y, width, height })
    .resize(maxDimension, maxDimension, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
    .sharpen()
    .jpeg({ quality: 90 })
    .toBuffer();

  // Upload to Cloudinary
  return await uploadToCloudinary(processedImage);
}

async function sendTelexHeadshot(headshotUrl: string) {
  if (!TELEX_WEBHOOK_URL) {
      console.error("❌ Telex Webhook URL is missing!");
      return;
  }

  const payload = {
      event_name: "Profile Icon Ready",
      username: "EstherBot",
      status: "success",
      message: `/profile Your AI-generated profile icon is ready!\n\n${headshotUrl}` // ✅ Use a text command with the URL
  };

  try {
      const response = await axios.post(TELEX_WEBHOOK_URL, payload, {
          headers: { "Content-Type": "application/json" }
      });
      console.log("✅ Telex Headshot Sent:", response.data);
    } catch (error) {
      if (error instanceof Error) {
          console.error('Error processing the image:', error.message);
          throw new Error(`Failed to process the image: ${error.message}`);
      } else {
          console.error('Unknown error:', error);
          throw new Error('An unknown error occurred while processing the image.');
      }
  }
}

// Mastra tool integration
export const profileIconTool = createTool({
  id: 'generate-headshot',
  description: 'Generate a cropped headshot from an uploaded profile photo using Imagga API and resize it to a square with padding',
  inputSchema: z.object({
    photoUrl: z.string().describe('URL of the uploaded image file'),
  }),
  outputSchema: z.object({
    headshotUrl: z.string(),
    message: z.string(),
  }),
  execute: async ({ context }) => {
    const { photoUrl } = context;

    try {
      // Detect face
      const faceData = await detectFaceWithPadding(photoUrl);

      // Crop & upload image
      const headshotUrl = await cropAndUploadFaceImage(photoUrl, faceData);

      // Send to Telex
      await sendTelexHeadshot(headshotUrl);

      return {
        headshotUrl: headshotUrl,
        message: 'Profile icon processed and uploaded successfully!',
      };
    } catch (error: any) {
      console.error('Error processing the image:', error.message);
      throw new Error(`Failed to process the image: ${error.message}`);
    }
  },
});

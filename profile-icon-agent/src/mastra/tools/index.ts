import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import axios from 'axios';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Imagga API credentials
const apiKey = 'acc_709326036b0cbea';
const apiSecret = 'e053ca0c7833ad01a5235cf002dd3e4f';

// Function to detect face using Imagga API and return adjusted cropping data with padding
async function detectFaceWithPadding(photoUrl: string, padding: number = 40) {
  const apiUrl = `https://api.imagga.com/v2/faces/detections?image_url=${encodeURIComponent(photoUrl)}`;

  const response = await axios.get(apiUrl, {
    auth: {
      username: apiKey,
      password: apiSecret,
    },
  });

  const faces = response.data.result.faces;

  // Log the response from Imagga for debugging
  console.log('Imagga API Face Detection Response:', faces);

  if (!faces || faces.length === 0) {
    throw new Error('No face detected in the image');
  }

  // Assume the first face detection result is the one we need
  const face = faces[0];
  const { coordinates } = face;

  // Log the face data to verify it has valid values
  console.log('Detected face data:', face);

  // Validate the bounding box coordinates
  if (
    coordinates.xmin === undefined || coordinates.ymin === undefined ||
    coordinates.xmax === undefined || coordinates.ymax === undefined
  ) {
    throw new Error('Invalid face detection coordinates received from Imagga');
  }

  return { coordinates, padding };
}

// Function to crop, resize to a square, and save the image locally with padding and improved quality
async function cropAndSaveFaceImageWithPadding(photoUrl: string, faceData: { coordinates: any, padding: number }) {
  const { coordinates, padding } = faceData;

  // Download the image as a buffer
  const imageResponse = await axios.get(photoUrl, { responseType: 'arraybuffer' });
  const imageBuffer = Buffer.from(imageResponse.data, 'binary');

  // Get image metadata to dynamically fetch the image dimensions
  const metadata = await sharp(imageBuffer).metadata();
  const imageWidth = metadata.width || 0;
  const imageHeight = metadata.height || 0;

  if (!imageWidth || !imageHeight) {
    throw new Error('Unable to retrieve image dimensions');
  }

  // Calculate width, height, and top-left position based on bounding box
  let x = Math.max(coordinates.xmin - padding, 0);  // Ensure x doesn't go negative
  let y = Math.max(coordinates.ymin - padding, 0);  // Ensure y doesn't go negative
  let width = coordinates.xmax - coordinates.xmin + 2 * padding;
  let height = coordinates.ymax - coordinates.ymin + 2 * padding;

  // Ensure the cropping dimensions don't exceed the image boundaries
  if (x + width > imageWidth) {
    width = imageWidth - x;
  }
  if (y + height > imageHeight) {
    height = imageHeight - y;
  }

  // Log the adjusted cropping data
  console.log(`Adjusted cropping data with padding: x=${x}, y=${y}, width=${width}, height=${height}`);

  // Determine the largest dimension to make the image a square
  const maxDimension = Math.max(width, height);

  // Use sharp to crop the image, then resize it to a perfect square with high-quality interpolation
  const croppedAndSquaredImage = await sharp(imageBuffer)
    .extract({
      left: x,
      top: y,
      width,
      height,
    })
    .resize(maxDimension, maxDimension, {
      fit: 'cover',              // Ensure it is resized to a square by covering the whole area
      kernel: sharp.kernel.lanczos3,  // Use high-quality interpolation (Lanczos3)
    })
    .sharpen()                    // Add sharpening to preserve detail
    .jpeg({ quality: 90 })        // Save as high-quality JPEG with reduced compression artifacts
    .toBuffer();

  // Get the current file's directory
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Define the file path for saving the image
  const savePath = path.join(__dirname, 'cropped-face-image-square-high-quality.jpg');

  // Save the cropped and resized image to the local machine
  fs.writeFileSync(savePath, croppedAndSquaredImage);

  return savePath;
}

// Mastra tool integration using Imagga with padding and high-quality image processing
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
      // Detect face and get the bounding box for cropping with padding
      const faceData = await detectFaceWithPadding(photoUrl);

      // Crop, resize to a square, and save the image locally with improved quality
      const savedImagePath = await cropAndSaveFaceImageWithPadding(photoUrl, faceData);

      // Return the path to the saved image
      return {
        headshotUrl: savedImagePath,
        message: 'Profile icon cropped with padding, resized to a square, and saved successfully',
      };
    } catch (error: any) {
      console.error('Error processing the image:', error.message);
      throw new Error(`Failed to process the image: ${error.message}`);
    }
  },
});

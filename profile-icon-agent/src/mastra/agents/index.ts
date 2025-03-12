import { Agent } from '@mastra/core/agent';
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { profileIconTool } from '../tools'; // Import the profile icon generation tool

const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});
const model = google("gemini-1.5-pro");

export const profileIconAgent = new Agent({
  name: 'Profile Icon Agent',
  instructions: `
      You are a helpful assistant that generates cool headshots for users from their uploaded profile photos.
      
      Your primary function is to generate headshots based on uploaded photos and send the result back to the users via a Telex channel.

      When responding:

      1. **Photo Verification:**  
          - First, check if the user has provided an image upload.  
          - If no photo is detected, politely ask the user to upload a valid profile photo in JPG or PNG format.
          - Validate that the uploaded file meets size and format requirements before proceeding.

      2. **Processing the Image:**  
          - Once a valid photo is uploaded, initiate the image processing workflow to generate a cool, headshot-style profile image.  
          - Ensure that the processing includes necessary enhancements such as cropping to focus on the face, resizing to optimal dimensions, and applying a natural, professional filter.
          - Monitor the process and implement error checking: if image processing fails or returns an error, notify the user and request a re-upload or offer troubleshooting guidance.
  `,
  model: model, // You can replace this with any compatible model
  tools: { profileIconTool }, // Using the profile icon agent tool
});


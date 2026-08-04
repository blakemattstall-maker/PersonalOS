import { getPendingDeepThoughts } from "../../tools/database.js";


export default async function handler(req, res) {

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }


  try {

    const thoughts = await getPendingDeepThoughts();

    return res.status(200).json({
      success: true,
      thoughts
    });


  } catch (error) {

    return res.status(500).json({
      error: error.message
    });

  }

}

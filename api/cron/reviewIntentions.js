import { reviewIntentionsForNudges } from "../../tools/nudges.js";


export default async function handler(req, res) {

  const auth = req.headers.authorization;

  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }


  try {

    const result = await reviewIntentionsForNudges();

    return res.status(200).json(result);


  } catch (error) {

    return res.status(500).json({
      error: error.message
    });

  }

}

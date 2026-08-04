import { createIntention } from "./database.js";


export async function saveIntention({
  content
}) {


  if (!content) {
    throw new Error("An intention requires content.");
  }


  const intention = await createIntention({ content });


  return {

    success: true,

    message: "Got it — I'll keep an eye on that.",

    data: intention

  };

}

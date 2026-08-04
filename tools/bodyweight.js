import { createBodyweightLog } from "./database.js";


export async function logBodyweight({
  weight,
  unit = "lbs"
}) {


  if (!weight) {
    throw new Error("Bodyweight log requires a weight.");
  }


  const log = await createBodyweightLog({ weight, unit });


  return {

    success: true,

    message: `Logged ${weight} ${unit}.`,

    data: log

  };

}

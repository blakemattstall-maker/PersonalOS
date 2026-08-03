import { saveMemory } from "../tools/memory.js";


export default async function handler(req, res) {

  const result = await saveMemory(
    "preference",
    "User prefers direct analytical feedback.",
    9
  );


  return res.status(200).json(result);

}
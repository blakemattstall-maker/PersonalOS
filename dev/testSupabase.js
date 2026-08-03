import supabase from "../lib/supabase.js";

export default async function handler(req, res) {

  const { data, error } = await supabase
    .from("profiles")
    .select("*");

  if (error) {
    return res.status(500).json({
      success: false,
      error
    });
  }

  return res.status(200).json({
    success: true,
    data
  });

}
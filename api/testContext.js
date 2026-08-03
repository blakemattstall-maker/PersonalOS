import { buildContext } from "../lib/context.js";


export default async function handler(req,res){

  try {

    const context = await buildContext();


    return res.status(200).json({
      success:true,
      context
    });


  } catch(error){

    return res.status(500).json({
      error:error.message
    });

  }

}
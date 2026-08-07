import { createCalendarEventRecord } from "../web/tools/database.js";


export default async function handler(req,res){

  try {

    const result = await createCalendarEventRecord({

      title:"Database test event",

      start_time:"2026-08-04T10:00:00-07:00",

      end_time:"2026-08-04T11:00:00-07:00"

    });


    return res.status(200).json({

      success:true,

      data:result

    });


  } catch(error){

    return res.status(500).json({

      error:error.message

    });

  }

}
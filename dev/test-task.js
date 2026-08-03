import { createTask } from "../tools/googleTasks";

export default async function handler(req,res){

  const task = await createTask(
    "Test PersonalOS task",
    new Date().toISOString()
  );

  res.json(task);

}
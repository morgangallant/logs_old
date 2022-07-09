import { OperandV3 } from "@operandinc/sdk";

const client = new OperandV3(
  process.env.OPERAND_API_KEY as string,
  process.env.OPERAND_API_ENDPOINT as string
);

export default client;

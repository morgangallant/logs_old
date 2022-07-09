import prisma from "lib/prisma";
import type { NextApiRequest, NextApiResponse } from "next";

export default async (req: NextApiRequest, res: NextApiResponse) => {
  const { id } = req.query;

  // Get the attachment from the database.
  const attachment = await prisma.attachment.findUnique({
    where: {
      id: id as string,
    },
  });

  // If we don't have an attachment, just return a 404.
  if (!attachment) {
    res.status(404).end();
    return;
  }

  // Write the file buffer to the response.
  res.status(200).end(attachment.contents);
};

import prisma from "lib/prisma";
import type { NextApiRequest, NextApiResponse } from "next";
import operand from "lib/operand";

/**
 * TelegramRequest is the request body from Telegram.
 */
type TelegramRequest = {
  update_id: number;
  message: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      last_name: string;
      username: string;
      language_code: string;
    };
    chat: {
      id: number;
      first_name: string;
      last_name: string;
      username: string;
      type: string;
    };
    date: number;
    text?: string;
    photo?: {
      file_id: string;
      file_unique_id: string;
      file_size: number;
      width: number;
      height: number;
    }[];
  };
};

/**
 * FileResponse is the response object from the getFile method.
 */
type FileResponse = {
  ok: boolean;
  result: {
    file_id: string;
    file_unique_id: string;
    file_size: number;
    file_path: string;
  };
};

export default async (req: NextApiRequest, res: NextApiResponse) => {
  const body = req.body as TelegramRequest;
  if (body.message.from.username != (process.env.TELEGRAM_USERNAME as string)) {
    console.log(`got message from ${body.message.from.username}, denying`);
    res.status(200).end();
    return;
  }

  // Get the collection ID from the environment. If we have one, we can index
  // the message content into this collection.
  const collectionId = process.env.OPERAND_COLLECTION_ID;

  if (body.message.text) {
    // Store the log.
    const log = await prisma.log.create({
      data: {
        message: body.message.text,
      },
    });

    // Index the log.
    if (collectionId && body.message.text.length > 0) {
      await operand.createObject({
        parentId: collectionId,
        type: "text",
        metadata: {
          text: body.message.text,
        },
        properties: {
          log: log.id,
        },
      });
    }

    // Log the message.
    console.log(`new text log: ${body.message.text}`);
  } else if (body.message.photo && body.message.photo.length > 0) {
    // Get the ID of the last photo in the message, i.e. the original file.
    // The other photos are smaller, compressed versions of the original.
    const id = body.message.photo[body.message.photo.length - 1].file_id;

    // Get the file from Telegram.
    const getFileResponse = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_KEY}/getFile?file_id=${id}`
    );
    const fileResponse = (await getFileResponse.json()) as FileResponse;

    // Download the file itself.
    const file = await fetch(
      `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_KEY}/${fileResponse.result.file_path}`
    );

    // Create the attachment in Prisma.
    const attachment = await prisma.attachment.create({
      data: {
        contents: Buffer.from(await file.arrayBuffer()),
      },
    });

    // Store the log.
    const log = await prisma.log.create({
      data: {
        Attachment: {
          connect: {
            id: attachment.id,
          },
        },
      },
    });

    // Index the log.
    if (collectionId) {
      await operand.createObject({
        parentId: collectionId,
        type: "image",
        metadata: {
          imageUrl: `${process.env.NEXT_PUBLIC_FRONTEND_URL}/api/attachment/${attachment.id}`,
        },
        properties: {
          log: log.id,
        },
      });
    }

    // Log the message.
    console.log(`new photo log: ${attachment.id}`);
  }

  // We're done!
  res.status(200).end();
};

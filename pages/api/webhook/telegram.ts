import prisma from "lib/prisma";
import type { NextApiRequest, NextApiResponse } from "next";
import operand from "lib/operand";
import { Event, EventType } from "@prisma/client";

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

/**
 * NewEvent is a utility type for creating a new event.
 */
type NewEvent = { type: EventType; meta?: any };

/**
 * An extractor is a function which takes a message from a user and extracts
 * one or more events from it. We store these events and possibly display them
 * to the user.
 */
type Extractor = (message: string) => Promise<NewEvent[]>;

// Creates good morning events for the user when they say "gm".
const gmExtractor: Extractor = async (message) => {
  if (message != "gm") {
    return [];
  }
  return [
    {
      type: "GOOD_MORNING",
    },
  ];
};

// Creates good night events for the user when they say "gn".
const gnExtractor: Extractor = async (message) => {
  if (message != "gn") {
    return [];
  }
  return [
    {
      type: "GOOD_NIGHT",
    },
  ];
};

/**
 * FoodItem is a set of nutritional information for a single food item.
 */
type FoodItem = {
  food_name: string;
  brand_name?: string;
  serving_qty: number;
  serving_unit: string;
  serving_weight_grams: number;
  nf_calories: number;
  nf_total_fat: number;
  nf_saturated_fat: number;
  nf_cholesterol: number;
  nf_sodium: number;
  nf_total_carbohydrate: number;
  nf_dietary_fiber: number;
  nf_sugars: number;
  nf_protein: number;
  nf_potassium: number;
  nf_p: number;
  photo?: {
    thumb: string;
    highres: string;
    is_user_uploaded: boolean;
  };
};

const getNutrition = async (message: string): Promise<FoodItem[]> => {
  const url = "https://trackapi.nutritionix.com/v2/natural/nutrients";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-app-id": process.env.NUTRITIONIX_APP_ID as string,
      "x-app-key": process.env.NUTRITIONIX_APP_KEY as string,
    },
    body: JSON.stringify({
      query: message,
      timezone: "US/Eastern",
    }),
  });
  if (!response.ok) {
    throw new Error(
      `error fetching nutrition for message '${message}': ${response.status}`
    );
  }
  const nr = (await response.json()) as {
    foods: FoodItem[];
  };
  return nr.foods;
};

// Creates events for whenever the user mentions that they ate or drank something.
const ateDrankExtractor: Extractor = async (message) => {
  const interestedWords = ["ate", "drank"];
  if (!interestedWords.some((word) => message.includes(word))) {
    return [];
  }

  // If we're here, we need to fire off a request to the Nutritionix API.
  // We're then able to extract the nutritional information about the foods
  // that the user ate or drank.
  const foods = await getNutrition(message);
  return foods.map((food) => ({
    type: "ATE_OR_DRANK",
    meta: food,
  }));
};

/**
 * The set of extractors we have.
 */
const extractors: Extractor[] = [gmExtractor, gnExtractor, ateDrankExtractor];

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

    // Run any extractors on the message and store them, if we get any.
    let events: NewEvent[] = [];
    for (const extractor of extractors) {
      const extracted = await extractor(body.message.text);
      events = events.concat(extracted);
    }
    if (events.length > 0) {
      await prisma.event.createMany({
        data: events.map((event) => ({
          ...event,
          logId: log.id,
        })),
      });
    }

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

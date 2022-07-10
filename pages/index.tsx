import * as React from "react";
import { ChatAltIcon, PhotographIcon } from "@heroicons/react/solid";
import prisma from "lib/prisma";
import type { GetServerSideProps, NextPage } from "next";
import operand from "lib/operand";
import { useRouter } from "next/router";
import { EventType } from "@prisma/client";

/**
 * LogObj is a type for the Log object.
 */
type LogObj = {
  Log: {
    id: string;
    createdAt: number;
    message: string | null;
    attachmentId: string | null;
  };
  AttachmentURL: string | null;
  Events: {
    type: EventType;
    meta: any;
  }[];
};

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { query } = context.query;

  // If we have a query, we do a semantic search and return only
  // the top matching logs to the user.
  const collectionId = process.env.OPERAND_COLLECTION_ID;
  if (query && query.length > 0 && collectionId) {
    const results = await operand.searchContents({
      parentIds: [collectionId],
      query: query as string,
      max: 12,
    });
    let logs: LogObj[] = [];
    let unique = new Set<string>();
    for (const content of results.contents) {
      if (unique.has(content.objectId)) {
        continue;
      }
      unique.add(content.objectId);
      const log = await prisma.log.findUnique({
        where: {
          id: results.objects[content.objectId].properties.log as string,
        },
        include: {
          Attachment: {
            select: {
              id: true,
            },
          },
          Events: true,
        },
      });
      if (log) {
        logs.push({
          Log: {
            id: log.id,
            createdAt: log.createdAt.getTime(),
            message: log.message,
            attachmentId: log.attachmentId,
          },
          AttachmentURL: log.Attachment
            ? `/api/attachment/${log.Attachment.id}`
            : null,
          Events: log.Events.map((e) => ({
            type: e.type,
            meta: e.meta,
          })),
        });
      }
    }

    // We've gotten all of the search results, return them.
    return {
      props: {
        logs,
        searchQuery: query as string,
      },
    };
  }

  // Fetch all the logs from the DB.
  // TODO: Eventually use context & pagination.
  const logs = await prisma.log.findMany({
    include: {
      Attachment: {
        select: {
          id: true,
        },
      },
      Events: true,
    },
    // Show the newest logs first.
    orderBy: {
      createdAt: "desc",
    },
  });

  // Map the return logs to the LogObj type.
  return {
    props: {
      logs: logs.map((log) => ({
        Log: {
          id: log.id,
          createdAt: log.createdAt.getTime(),
          message: log.message,
          attachmentId: log.attachmentId,
        },
        AttachmentURL: log.Attachment
          ? `/api/attachment/${log.Attachment.id}`
          : null,
        Events: log.Events.map((e) => ({
          type: e.type,
          meta: e.meta,
        })),
      })) as LogObj[],
      searchQuery: null,
    },
  };
};

/**
 * Item is a element to render in the UI.
 */
type Item = {
  id: string;
  type: "text" | "image";
  date: number;
  message: string | null;
  attachmentUrl: string | null;
  events: {
    type: EventType;
    meta: any;
  }[];
};

// Index is the main page of the app.
const Index: NextPage<{
  logs: LogObj[];
  searchQuery: string | null;
}> = ({ logs, searchQuery }) => {
  const router = useRouter();

  // Items state.
  const [items, setItems] = React.useState<Item[]>([]);

  // Search state.
  const [query, setQuery] = React.useState<string>("");

  // Update the items state. Prevents hydration errors.
  React.useEffect(() => {
    setItems(
      logs.map((log) => ({
        id: log.Log.id,
        type: log.Log.attachmentId != null ? "image" : "text",
        date: log.Log.createdAt,
        message: log.Log.message,
        attachmentUrl: log.AttachmentURL,
        events: log.Events,
      }))
    );
  }, [logs]);

  // Render an event.
  const renderEvent = (event: {
    type: EventType;
    meta: any;
    occuredAt: number;
  }) => {
    switch (event.type) {
      case "GOOD_MORNING":
        return <p className="text-sm text-gray-700">Woke up.</p>;
      case "GOOD_NIGHT":
        return <p className="text-sm text-gray-700">Went to bed.</p>;
      case "ATE_OR_DRANK":
        console.log(event.meta);
        // This is a food item, so we can render a thumbnail, it's name,
        // a small summary of nutritional information.
        return (
          <div className="flex flex-col">
            <div className="flex flex-row">
              {event.meta.photo && (
                <img
                  className="h-8 w-8 rounded-full"
                  src={event.meta.photo.thumb}
                  alt="Food thumbnail"
                />
              )}
              <div className="flex-1">
                <p className="text-sm text-gray-700">
                  {event.meta.food_name} ({event.meta.serving_qty}{" "}
                  {event.meta.serving_unit})
                </p>
                <p className="text-sm text-gray-700">
                  {event.meta.nf_calories} cals, {event.meta.nf_total_fat}g fat,{" "}
                  {event.meta.nf_total_carbohydrate}g carbs,{" "}
                  {event.meta.nf_protein}g protein
                </p>
              </div>
            </div>
          </div>
        );
      default:
        return (
          <p className="text-sm text-gray-700">
            Unknown event type: {event.type}
          </p>
        );
    }
  };

  return (
    <div className="sm:container mx-auto px-4">
      <div className="flow-root">
        <p>these are my logs. hope u like them uwu</p>
        <br />
        {searchQuery != null ? (
          <>
            <p>showing results for &quot;{searchQuery}&quot;...</p>
            <a
              className="underline cursor-pointer"
              onClick={() => {
                setQuery("");
                router.push("/");
              }}
            >
              clear search
            </a>
          </>
        ) : (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (query != "") {
                  router.push(`/?query=${query}`);
                }
              }}
              className="flex items-center"
            >
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="search"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              />
              <input
                type="submit"
                value="search"
                className="rounded-lg px-3 bg-gray-100 cursor-pointer"
              />
            </form>
          </>
        )}
        <ul role="list" className="mt-4 -mb-8">
          {items.map((item, itemIdx) => (
            <li key={item.id}>
              <div className="relative pb-8">
                {itemIdx !== items.length - 1 ? (
                  <span
                    className="absolute top-5 left-5 -ml-px h-full w-0.5 bg-gray-200"
                    aria-hidden="true"
                  />
                ) : null}
                <div className="relative flex items-start space-x-3">
                  {item.type === "text" ? (
                    <>
                      <div className="relative">
                        <img
                          className="h-10 w-10 rounded-full bg-gray-400 flex items-center justify-center ring-8 ring-white"
                          src={process.env.NEXT_PUBLIC_PROFILE_IMAGE_URL}
                          alt="Profile image"
                        />

                        <span className="absolute -bottom-0.5 -right-1 bg-white rounded-tl px-0.5 py-px">
                          <ChatAltIcon
                            className="h-4 w-4 text-gray-400"
                            aria-hidden="true"
                          />
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div>
                          <p className="mt-0.5 text-sm text-gray-500">
                            Logged on {new Date(item.date).toLocaleString()}
                          </p>
                        </div>
                        <div className="mt-2 text-sm text-gray-700">
                          <p>{item.message}</p>
                        </div>
                        {item.events.length > 0 && (
                          <div className="mt-2">
                            <p className="text-sm text-gray-700">
                              <strong>Extracted events:</strong>
                            </p>
                            <ul className="mt-2">
                              {item.events.map((e, i) => (
                                <li key={i}>
                                  {renderEvent({
                                    ...e,
                                    occuredAt: item.date,
                                  })}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    item.attachmentUrl && (
                      <>
                        <div className="relative">
                          <img
                            className="h-10 w-10 rounded-full bg-gray-400 flex items-center justify-center ring-8 ring-white"
                            src={process.env.NEXT_PUBLIC_PROFILE_IMAGE_URL}
                            alt="Profile image"
                          />

                          <span className="absolute -bottom-0.5 -right-1 bg-white rounded-tl px-0.5 py-px">
                            <PhotographIcon
                              className="h-4 w-4 text-gray-400"
                              aria-hidden="true"
                            />
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div>
                            <p className="mt-0.5 text-sm text-gray-500">
                              Logged on {new Date(item.date).toLocaleString()}
                            </p>
                          </div>
                          <div className="mt-2 text-sm text-gray-700">
                            <img
                              src={item.attachmentUrl}
                              className="w-64 h-64 cursor-pointer"
                              onClick={() => {
                                window.location.href =
                                  item.attachmentUrl as string;
                              }}
                              alt="Attachment"
                            />
                          </div>
                        </div>
                      </>
                    )
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default Index;

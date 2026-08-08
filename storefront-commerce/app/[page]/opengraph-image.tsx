import OpengraphImage from "components/opengraph-image";
import { getPage } from "lib/commerce";

export default async function Image({ params }: { params: { page: string } }) {
  const page = await getPage(params.page);

  return await OpengraphImage(
    page ? { title: page.seo?.title || page.title } : undefined,
  );
}

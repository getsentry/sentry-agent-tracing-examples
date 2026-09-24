process.env.DD_CLI_FIXTURES = "1";

import assert from "node:assert";
import {
  ddCartAddItems,
  ddCartList,
  ddCheckoutUrl,
  ddItemDetails,
  ddMenu,
  ddOrderPreview,
  ddSearch,
  defaultDeliveryPoint,
  showCart,
  storeIsOpen,
} from "../agent/lib/dd";

async function main() {
  const deliveryPoint = await defaultDeliveryPoint();
  assert.ok(deliveryPoint.lat && deliveryPoint.lng, "defaultDeliveryPoint should return coordinates");
  console.log("ok defaultDeliveryPoint");

  const restaurants = await ddSearch("tacos");
  assert.ok(restaurants.length > 0, "ddSearch should return restaurants");
  const restaurant = restaurants[0]!;
  console.log("ok ddSearch");

  const menu = await ddMenu(restaurant.storeId);
  assert.ok(menu.items.length > 0, "ddMenu should return items");
  const menuItem = menu.items[0]!;
  console.log("ok ddMenu");

  const details = await ddItemDetails(restaurant.storeId, menu.menuId, menuItem.itemId);
  assert.ok(details.extras.length > 0, "ddItemDetails should return option groups");
  const extra = details.extras[0]!;
  const option = extra.options[0]!;
  console.log("ok ddItemDetails");

  const addOutcome = await ddCartAddItems(
    restaurant.storeId,
    menu.menuId,
    undefined,
    JSON.stringify([
      {
        item_id: menuItem.itemId,
        item_name: menuItem.name,
        quantity: 1,
        nested_options: [{ id: option.optionId, name: option.name, quantity: 1 }],
      },
    ]),
  );
  assert.ok(addOutcome.added, "ddCartAddItems should succeed");
  assert.ok(addOutcome.cart.items.length > 0, "cart should show the added line");
  const cartUuid = addOutcome.cart.cartUuid;
  console.log("ok ddCartAddItems");

  const cartUuids = await ddCartList();
  assert.ok(cartUuids.includes(cartUuid), "ddCartList should include the cart used for the add");
  console.log("ok ddCartList");

  const cart = await showCart(cartUuid);
  assert.ok(cart.items.length > 0, "showCart should show the added line");
  console.log("ok showCart");

  const isOpen = await storeIsOpen(restaurant.storeId);
  assert.strictEqual(isOpen, true, "storeIsOpen should report open");
  console.log("ok storeIsOpen");

  const quote = await ddOrderPreview(cartUuid);
  assert.ok(quote.lines.length > 0, "ddOrderPreview should return pricing lines");
  console.log("ok ddOrderPreview");

  const checkoutUrl = await ddCheckoutUrl(cartUuid);
  assert.ok(checkoutUrl, "ddCheckoutUrl should return a link");
  console.log("ok ddCheckoutUrl");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

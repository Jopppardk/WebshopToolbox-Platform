// Synthetic QA data only. Never imported by application runtime.
export const money = (amount) => ({
  shopMoney: { amount: String(amount), currencyCode: 'DKK' },
});
export function fixture() {
  return {
    id: 'gid://shopify/Order/999999',
    name: '#TEST-999999',
    createdAt: '2026-09-04T08:00:00Z',
    updatedAt: '2026-09-04T08:00:00Z',
    processedAt: '2026-09-04T08:00:00Z',
    fulfillments: [{ createdAt: '2026-09-04T09:00:00Z', status: 'SUCCESS' }],
    test: false,
    edited: false,
    cancelledAt: null,
    taxesIncluded: true,
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'FULFILLED',
    billingAddress: {
      name: 'Testkunde Æble Øster',
      address1: 'Testvej 1',
      zip: '7500',
      city: 'Holstebro',
      country: 'Danmark',
      countryCodeV2: 'DK',
    },
    shippingAddress: null,
    currentTotalPriceSet: money('162.50'),
    currentSubtotalPriceSet: money('112.50'),
    currentTotalTaxSet: money('32.50'),
    totalPriceSet: money('162.50'),
    totalTaxSet: money('32.50'),
    totalRefundedSet: money('0'),
    lineItems: {
      nodes: [
        {
          id: 'line1',
          name: 'Testvare - æ, ø og å',
          quantity: 1,
          currentQuantity: 1,
          requiresShipping: true,
          isGiftCard: false,
          originalTotalSet: money('125'),
          discountedTotalSet: money('125'),
          discountAllocations: [{ allocatedAmountSet: money('12.50') }],
          taxLines: [
            { priceSet: money('22.50'), rate: 0.25, channelLiable: false },
          ],
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    shippingLines: {
      nodes: [
        {
          id: 'ship1',
          title: 'Levering',
          isRemoved: false,
          originalPriceSet: money('50'),
          discountedPriceSet: money('50'),
          discountAllocations: [],
          taxLines: [
            { priceSet: money('10'), rate: 0.25, channelLiable: false },
          ],
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}

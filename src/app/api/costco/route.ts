import { NextRequest, NextResponse } from 'next/server'

const COSTCO_URL = 'https://ecom-api.costco.com/ebusiness/order/v1/orders/graphql'

function costcoHeaders(token: string) {
  return {
    'Content-Type':           'application/json-patch+json',
    'Accept':                 '*/*',
    'costco-x-authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
    'costco-x-wcs-clientid':  '4900eb1f-0c10-4bd9-99c3-c59e6c1ecebf',
    'client-identifier':      '481b1aec-aa3b-454b-b81b-48187e28f205',
    'costco.env':             'ecom',
    'costco.service':         'restOrders',
    'origin':                 'https://www.costco.com',
    'referer':                'https://www.costco.com/',
    'user-agent':             'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  }
}

const LIST_QUERY = `query receiptsWithCounts($startDate: String!, $endDate: String!, $documentType: String!, $documentSubType: String!) {
  receiptsWithCounts(startDate: $startDate, endDate: $endDate, documentType: $documentType, documentSubType: $documentSubType) {
    inWarehouse
    receipts {
      warehouseName
      receiptType
      transactionDateTime
      transactionBarcode
      total
      totalItemCount
      instantSavings
      tenderArray {
        tenderDescription
        amountTender
        displayAccountNumber
      }
    }
  }
}`

const DETAIL_QUERY = `query receiptsWithCounts($barcode: String!, $documentType: String!) {
  receiptsWithCounts(barcode: $barcode, documentType: $documentType) {
    receipts {
      warehouseName
      transactionDate
      transactionDateTime
      transactionBarcode
      total
      subTotal
      taxes
      instantSavings
      membershipNumber
      warehouseAddress1
      warehouseCity
      warehouseState
      warehousePostalCode
      totalItemCount
      itemArray {
        itemNumber
        itemDescription01
        itemDescription02
        unit
        amount
        itemUnitPriceAmount
        fuelUnitQuantity
        fuelUomCode
      }
      tenderArray {
        tenderDescription
        amountTender
        displayAccountNumber
      }
    }
  }
}`

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { type, token } = body

    if (!token) return NextResponse.json({ error: 'Token required.' }, { status: 400 })

    let query: string
    let variables: Record<string, string>

    if (type === 'list') {
      query = LIST_QUERY
      variables = {
        startDate:    body.startDate,
        endDate:      body.endDate,
        documentType: 'all',
        documentSubType: 'all',
      }
    } else if (type === 'detail') {
      query = DETAIL_QUERY
      variables = {
        barcode:      body.barcode,
        documentType: 'all',
      }
    } else {
      return NextResponse.json({ error: 'Invalid type.' }, { status: 400 })
    }

    const res = await fetch(COSTCO_URL, {
      method:  'POST',
      headers: costcoHeaders(token),
      body:    JSON.stringify({ query, variables }),
    })

    if (res.status === 401) {
      return NextResponse.json(
        { error: 'Token expired — paste a fresh Bearer token from DevTools.' },
        { status: 401 },
      )
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: `Costco API returned ${res.status}.` },
        { status: res.status },
      )
    }

    const data = await res.json()

    // GraphQL errors come inside the 200 response body
    if (data.errors?.length) {
      return NextResponse.json(
        { error: data.errors[0]?.message ?? 'Costco API error.' },
        { status: 400 },
      )
    }

    return NextResponse.json(data)
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Proxy error.' }, { status: 500 })
  }
}

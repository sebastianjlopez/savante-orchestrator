import { Pricing } from "aws-sdk";

export interface ServicePricingInfo {
  serviceCode: string;
  serviceName: string;
  description: string;
  pricing: PricingDetail[];
}

export interface PricingDetail {
  termType: "OnDemand" | "Reserved";
  pricePerUnit: number;
  unit: string;
  description: string;
}

export class AWSPriceClient {
  private pricing: Pricing;

  constructor(region: string = "us-east-1") {
    this.pricing = new Pricing({ region });
  }

  /**
   * Queries AWS Pricing API for a given service.
   * Returns a formatted string with service description and pricing details.
   */
  async getServicePricing(serviceName: string): Promise<string> {
    try {
      // Map common service names to AWS service codes
      const serviceCode = this.getServiceCode(serviceName);

      const params: Pricing.GetProductsRequest = {
        ServiceCode: serviceCode,
        MaxResults: 10,
      };

      const result = await this.pricing.getProducts(params).promise();

      if (!result.PriceList || result.PriceList.length === 0) {
        return `No pricing information found for service: ${serviceName} (code: ${serviceCode})`;
      }

      // Parse the first few pricing entries
      const pricingDetails = this.parsePriceList(result.PriceList);

      return this.formatPricingInfo(serviceCode, serviceName, pricingDetails);
    } catch (error) {
      console.error(`[AWSPriceClient] Error fetching pricing for ${serviceName}:`, error);
      return `Error fetching pricing for ${serviceName}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Maps common service names to AWS service codes.
   */
  private getServiceCode(serviceName: string): string {
    const serviceMap: Record<string, string> = {
      // Compute
      "lambda": "AWSLambda",
      "aws lambda": "AWSLambda",
      "ec2": "AmazonEC2",
      "aws ec2": "AmazonEC2",
      "ecs": "AmazonECS",
      "fargate": "AmazonECS",
      // Storage
      "s3": "AmazonS3",
      "aws s3": "AmazonS3",
      "ebs": "AmazonEC2",
      "efs": "AmazonEFS",
      // Database
      "dynamodb": "AmazonDynamoDB",
      "aws dynamodb": "AmazonDynamoDB",
      "rds": "AmazonRDS",
      "aws rds": "AmazonRDS",
      "aurora": "AmazonRDS",
      // Networking
      "api gateway": "AmazonApiGateway",
      "apigateway": "AmazonApiGateway",
      "vpc": "AmazonVPC",
      "cloudfront": "AmazonCloudFront",
      // Security
      "cognito": "AmazonCognito",
      "iam": "AWSIAM",
      "secrets manager": "AWSSecretsManager",
      // Monitoring
      "cloudwatch": "AmazonCloudWatch",
      "x-ray": "AWSXRay",
    };

    const normalized = serviceName.toLowerCase().trim();
    return serviceMap[normalized] || serviceName;
  }

  /**
   * Parses the AWS Price List JSON and extracts key pricing details.
   */
  private parsePriceList(priceList: any[]): PricingDetail[] {
    const details: PricingDetail[] = [];

    try {
      for (const item of priceList.slice(0, 5)) {
        const product = item.product || {};
        const terms = item.terms || {};

        // Extract product description
        const productDescription = product.attributes?.servicecode || "Unknown";

        // Extract on-demand pricing
        const onDemand = terms.OnDemand || {};
        for (const key of Object.keys(onDemand)) {
          const offer = onDemand[key];
          const priceDimensions = offer.priceDimensions || {};
          for (const dimKey of Object.keys(priceDimensions)) {
            const dim = priceDimensions[dimKey];
            details.push({
              termType: "OnDemand",
              pricePerUnit: parseFloat(dim.pricePerUnit?.USD || "0"),
              unit: dim.unit || "N/A",
              description: dim.description || productDescription,
            });
          }
        }

        // Extract reserved pricing (if available)
        const reserved = terms.Reserved || {};
        for (const key of Object.keys(reserved).slice(0, 3)) {
          const offer = reserved[key];
          const priceDimensions = offer.priceDimensions || {};
          for (const dimKey of Object.keys(priceDimensions)) {
            const dim = priceDimensions[dimKey];
            details.push({
              termType: "Reserved",
              pricePerUnit: parseFloat(dim.pricePerUnit?.USD || "0"),
              unit: dim.unit || "N/A",
              description: dim.description || productDescription,
            });
          }
        }
      }
    } catch (error) {
      console.error("[AWSPriceClient] Error parsing price list:", error);
    }

    return details;
  }

  /**
   * Formats pricing information into a readable string.
   */
  private formatPricingInfo(serviceCode: string, serviceName: string, details: PricingDetail[]): string {
    let output = `## ${serviceName} (${serviceCode})\n\n`;

    if (details.length === 0) {
      output += "No pricing details available.\n";
      return output;
    }

    // Group by term type
    const onDemand = details.filter(d => d.termType === "OnDemand");
    const reserved = details.filter(d => d.termType === "Reserved");

    if (onDemand.length > 0) {
      output += "### On-Demand Pricing\n";
      for (const detail of onDemand.slice(0, 3)) {
        output += `- ${detail.description}: $${detail.pricePerUnit.toFixed(4)} per ${detail.unit}\n`;
      }
      output += "\n";
    }

    if (reserved.length > 0) {
      output += "### Reserved Pricing (sample)\n";
      for (const detail of reserved.slice(0, 3)) {
        output += `- ${detail.description}: $${detail.pricePerUnit.toFixed(4)} per ${detail.unit}\n`;
      }
      output += "\n";
    }

    return output;
  }
}

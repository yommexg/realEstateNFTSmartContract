const { expect } = require("chai");
const { ethers } = require("hardhat");

const tokens = (n) => {
  return ethers.utils.parseUnits(n.toString(), "ether");
};

describe("Escrow", () => {
  let buyer, seller, inspector, lender;
  let realEstate, escrow;

  beforeEach(async () => {
    [buyer, seller, inspector, lender] = await ethers.getSigners();

    // Real Estate
    const RealEstate = await ethers.getContractFactory("RealEstate");
    realEstate = await RealEstate.deploy();
    await realEstate.deployed(); // Ensure contract is deployed

    // Mint
    let transaction = await realEstate
      .connect(seller)
      .mint(
        "https://ipfs.io/ipfs/QmTudSYeM7mz3PkYEWXWqPjomRPHogcMFSq7XAvsvsgAPS"
      );

    await transaction.wait();

    const Escrow = await ethers.getContractFactory("Escrow");

    escrow = await Escrow.deploy(
      realEstate.address,
      seller.address,
      inspector.address,
      lender.address
    );

    //Approve Property
    transaction = await realEstate.connect(seller).approve(escrow.address, 1);
    await transaction.wait();

    //list property
    transaction = await escrow
      .connect(seller)
      .list(1, buyer.address, tokens(10), tokens(5));
    await transaction.wait();
  });

  describe("Deployment", () => {
    it("Returns NFT Address", async () => {
      const result = await escrow.nftAddress();
      expect(result).to.be.equal((await realEstate).address);
    });

    it("Returns Seller", async () => {
      const result = await escrow.seller();
      expect(result).to.be.equal(seller.address);
    });

    it("Returns Inspector", async () => {
      const result = await escrow.inspector();
      expect(result).to.be.equal(inspector.address);
    });

    it("Returns Lender", async () => {
      const result = await escrow.lender();
      expect(result).to.be.equal(lender.address);
    });
  });

  describe("Listing", () => {
    it("Update as Listed", async () => {
      const result = await escrow.isListed(1);
      expect(result).to.be.equal(true);
    });

    it("Update Ownership", async () => {
      expect(await realEstate.ownerOf(1)).to.be.equal(escrow.address);
    });

    it("Returns buyer", async () => {
      const result = await escrow.buyer(1);
      expect(result).to.be.equal(buyer.address);
    });

    it("Returns purchase price", async () => {
      const result = await escrow.purchasePrice(1);
      expect(result).to.be.equal(tokens(10));
    });

    it("Returns escrow amount", async () => {
      const result = await escrow.escrowAmount(1);
      expect(result).to.be.equal(tokens(5));
    });
  });

  describe("Deposits", () => {
    it("Updates Contract Balance", async () => {
      const transaction = await escrow.connect(buyer).depositEarnest(1, {
        value: tokens(5),
      });

      await transaction.wait();
      const result = await escrow.getBalance();
      expect(result).to.be.equal(tokens(5));
    });
  });

  describe("Inspection", () => {
    it("Updates Inspection Status", async () => {
      const transaction = await escrow
        .connect(inspector)
        .updateInspectionStatus(1, true);
      await transaction.wait();
      const result = await escrow.inspectionPassed(1);
      expect(result).to.be.equal(true);
    });
  });

  describe("Approval", () => {
    it("Updates Approval Status", async () => {
      let transaction = await escrow.connect(buyer).approveSale(1);
      await transaction.wait();

      transaction = await escrow.connect(seller).approveSale(1);
      await transaction.wait();

      transaction = await escrow.connect(lender).approveSale(1);
      await transaction.wait();

      expect(await escrow.approval(1, buyer.address)).to.be.equal(true);
      expect(await escrow.approval(1, seller.address)).to.be.equal(true);
      expect(await escrow.approval(1, lender.address)).to.be.equal(true);
    });
  });

  describe("Sale", () => {
    beforeEach(async () => {
      let transaction = await escrow.connect(buyer).depositEarnest(1, {
        value: tokens(5),
      });
      await transaction.wait();

      transaction = await escrow
        .connect(inspector)
        .updateInspectionStatus(1, true);
      await transaction.wait();

      transaction = await escrow.connect(buyer).approveSale(1);
      await transaction.wait();

      transaction = await escrow.connect(seller).approveSale(1);
      await transaction.wait();

      transaction = await escrow.connect(lender).approveSale(1);
      await transaction.wait();

      await lender.sendTransaction({
        to: escrow.address,
        value: tokens(5),
      });

      transaction = await escrow.connect(seller).finalizeSale(1);
      await transaction.wait();
    });

    it("Updates ownership", async () => {
      expect(await realEstate.ownerOf(1)).to.be.equal(buyer.address);
    });

    it("Updates balance", async () => {
      expect(await escrow.getBalance()).to.be.equal(0);
    });
  });

  describe("Cancel Sale", () => {
    it("Fails Inspection and Cancels Sale", async () => {
      // Buyer deposits earnest money
      let transaction = await escrow.connect(buyer).depositEarnest(1, {
        value: tokens(5),
      });
      await transaction.wait();

      // Fail the inspection
      transaction = await escrow
        .connect(inspector)
        .updateInspectionStatus(1, false);
      await transaction.wait();

      // Cancel the sale (assuming seller cancels after failed inspection)
      transaction = await escrow.connect(seller).cancelSale(1);
      await transaction.wait();

      // Ensure the buyer is refunded
      const buyerBalance = await ethers.provider.getBalance(buyer.address);
      expect(buyerBalance).to.be.above(tokens(5)); // Check if buyer got refunded, adjust for gas

      // Ensure the NFT is returned to the seller
      const nftOwner = await realEstate.ownerOf(1);
      expect(nftOwner).to.be.equal(seller.address);

      // Check if the sale is no longer listed
      const isListed = await escrow.isListed(1);
      expect(isListed).to.be.equal(false);
    });

    it("Passes Inspection and Cancels Sale", async () => {
      // Buyer deposits earnest money
      let transaction = await escrow.connect(buyer).depositEarnest(1, {
        value: tokens(5),
      });
      await transaction.wait();

      // Pass the inspection
      transaction = await escrow
        .connect(inspector)
        .updateInspectionStatus(1, true);
      await transaction.wait();

      // Cancel the sale (assuming seller cancels after inspection passes)
      transaction = await escrow.connect(seller).cancelSale(1);
      await transaction.wait();

      // Ensure the seller receives the balance
      const sellerBalance = await ethers.provider.getBalance(seller.address);
      expect(sellerBalance).to.be.above(tokens(5)); // Check if seller got the funds, adjust for gas

      // Ensure the NFT is returned to the seller
      const nftOwner = await realEstate.ownerOf(1);
      expect(nftOwner).to.be.equal(seller.address);

      // Check if the sale is no longer listed
      const isListed = await escrow.isListed(1);
      expect(isListed).to.be.equal(false);
    });
  });
});

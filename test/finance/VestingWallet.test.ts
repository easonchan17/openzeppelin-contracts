import { expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber, Signer } from "ethers";
import { Address } from "hardhat-deploy/types";
import { VestingWallet }from "../src/types/VestingWallet";
import { VestingWallet__factory } from "../src/types/factories/VestingWallet__factory";

type DeployContractReturnType = [
    Signer,          // deployer
    Signer,          // beneficiary
    Signer,          // anyone
    Address,         // deployerAddress
    Address,         // beneficiaryAddress
    Address,         // anyoneAddress
    VestingWallet    // vestingWallet
];

async function deployContract(
    startTimestamp: any,
    durationSeconds: any,
    totalAllocation: any,
    initBalance: any
): Promise<DeployContractReturnType> {
    const [deployer, beneficiary, anyone] = await ethers.getSigners() as unknown as [Signer, Signer, Signer];

    const deployerAddress    = await deployer.getAddress() as Address;
    const beneficiaryAddress = await beneficiary.getAddress() as  Address;
    const anyoneAddress      = await anyone.getAddress() as Address;

    const factory = new VestingWallet__factory(deployer);
    let vestingWallet = await factory.deploy(
        beneficiaryAddress,
        startTimestamp,
        durationSeconds,
        totalAllocation, {
            value: initBalance
        }
    ) as VestingWallet;

    return [
        deployer,
        beneficiary,
        anyone,
        deployerAddress,
        beneficiaryAddress,
        anyoneAddress,
        vestingWallet
    ]
}

function getReleasableAmount(
    timestamp: BigNumber,
    startTimestamp: BigNumber,
    durationSeconds: BigNumber,
    totalAllocation: BigNumber
): BigNumber {
    if (timestamp.lt(startTimestamp)) {
        return BigNumber.from(0);
    }

    const endTimestamp = startTimestamp.add(durationSeconds);
    if (timestamp.gte(endTimestamp)) {
        return totalAllocation;
    }

    return totalAllocation.mul(timestamp.sub(startTimestamp)).div(durationSeconds);
}

describe("VestingWallet", function() {
    describe("#Deployment,Ownership,Receive", function() {
        let deployer: Signer;
        let beneficiary: Signer;
        let anyone: Signer;

        let deployerAddress: Address;
        let beneficiaryAddress: Address;
        let anyoneAddress: Address;

        let vestingWallet: VestingWallet;

        const ZERO_ADDRESS      = "0x0000000000000000000000000000000000000000";
        const startTimestamp    = Math.floor( Date.now() / 1000 );
        const durationSeconds   = 4 * 365 * 86400;                              // 4 years
        const totalAllocation   = BigNumber.from(10).pow(BigNumber.from(27));   // 1,000,000,000 eth
        const initBalance       = BigNumber.from(10).pow(BigNumber.from(20));   // 100 eth

        before(async () => {
            [
                deployer,
                beneficiary,
                anyone,
                deployerAddress,
                beneficiaryAddress,
                anyoneAddress,
                vestingWallet
            ] = await deployContract(
                startTimestamp,
                durationSeconds,
                totalAllocation,
                initBalance
            );
        });


        describe("#deployment", async () => {
            it("check deploy info", async function () {
                expect(
                    await vestingWallet.owner()
                ).to.be.equal(
                    beneficiaryAddress
                )

                expect(
                    await vestingWallet.start()
                ).to.be.equal(
                    startTimestamp
                )

                expect(
                    await vestingWallet.duration()
                ).to.be.equal(
                    durationSeconds
                )

                expect(
                    await vestingWallet.end()
                ).to.be.equal(
                    startTimestamp + durationSeconds
                )

                expect(
                    await vestingWallet.totalAlloc()
                ).to.be.equal(
                    totalAllocation
                )

                expect(
                    await vestingWallet.released()
                ).to.be.equal(0)

                expect(
                    await ethers.provider.getBalance(vestingWallet.address)
                ).to.be.equal(
                    initBalance
                )
            })

            it("deploy with zero beneficiary address", async function () {
                const error = `OwnableInvalidOwner("${ZERO_ADDRESS}")`;
                const factory = new VestingWallet__factory(deployer);
                await expect(
                    factory.deploy(
                        ZERO_ADDRESS,
                        startTimestamp,
                        durationSeconds,
                        totalAllocation
                    )
                ).to.be.revertedWith(error)
            })
        })

        describe("#ownership", async () => {
            it("transfer ownership permission deny", async function() {
                const error = `OwnableUnauthorizedAccount("${anyoneAddress}")`;
                await expect(
                    vestingWallet.connect(anyone).transferOwnership(anyoneAddress)
                ).to.be.revertedWith(error)
            })

            it("transfer ownership", async function () {
                await expect(
                    await vestingWallet.connect(beneficiary).transferOwnership(anyoneAddress)
                ).to.emit(
                    vestingWallet,
                    "OwnershipTransferStarted"
                ).withArgs(
                    beneficiaryAddress,
                    anyoneAddress
                )

                await expect(
                    await vestingWallet.owner()
                ).to.be.equal(
                    beneficiaryAddress
                )

                await expect(
                    await vestingWallet.pendingOwner()
                ).to.be.equal(
                    anyoneAddress
                )
            })

            it("accept ownership permission deny", async function() {
                const error = `OwnableUnauthorizedAccount("${beneficiaryAddress}")`;
                await expect(
                    vestingWallet.connect(beneficiary).acceptOwnership()
                ).to.be.revertedWith(error)
            })

            it("accept ownership", async function () {
                await expect(
                    await vestingWallet.connect(anyone).acceptOwnership()
                ).to.emit(
                    vestingWallet,
                    "OwnershipTransferred"
                ).withArgs(
                    beneficiaryAddress,
                    anyoneAddress
                )

                await expect(
                    await vestingWallet.pendingOwner()
                ).to.be.equal(
                    ZERO_ADDRESS
                )

                await expect(
                    await vestingWallet.owner()
                ).to.be.equal(
                    anyoneAddress
                )
            })

            it("renounce ownership permission deny", async function() {
                const error = `OwnableUnauthorizedAccount("${beneficiaryAddress}")`;
                await expect(
                    vestingWallet.connect(beneficiary).renounceOwnership()
                ).to.be.revertedWith(error)
            })

            it("renounce ownership", async function () {
                await expect(
                    vestingWallet.connect(anyone).renounceOwnership()
                ).to.be.revertedWith(
                    "Ownable: can't renounce ownership"
                )
            })
        })

        describe("#receive", async () => {
            it("receive funds", async () => {
                const depositAmount   = BigNumber.from(100).mul(BigNumber.from(10).pow(BigNumber.from(18)));
                const expectedBalance = depositAmount.add(await ethers.provider.getBalance(vestingWallet.address));

                await expect(
                    await deployer.sendTransaction({
                        to: vestingWallet.address,
                        value: depositAmount
                    })
                ).to.emit(
                    vestingWallet,
                    "EtherReceived"
                ).withArgs(
                    deployerAddress,
                    depositAmount
                )

                await expect(
                    await ethers.provider.getBalance(vestingWallet.address)
                ).to.be.equal(
                    expectedBalance
                )
            })
        })
    })

    describe("#Release", function() {
        let deployer: Signer;
        let beneficiary: Signer;
        let anyone: Signer;

        let deployerAddress: Address;
        let beneficiaryAddress: Address;
        let anyoneAddress: Address;

        let vestingWallet: VestingWallet;

        const startTimestamp    = BigNumber.from(Math.floor( Date.now() / 1000 )).sub(86400); // one day ago
        const durationSeconds   = BigNumber.from(4 * 365 * 86400);              // 4 years
        const totalAllocation   = BigNumber.from(10).pow(25);                   // 10,000,000 eth

        const endTimestamp: BigNumber = startTimestamp.add(durationSeconds);

        beforeEach(async () => {
            [
                deployer,
                beneficiary,
                anyone,
                deployerAddress,
                beneficiaryAddress,
                anyoneAddress,
                vestingWallet
            ] = await deployContract(
                startTimestamp,
                durationSeconds,
                totalAllocation,
                0
            );
        });

        describe("#vested amount", async () => {
            it("timestamp before startTimestamp", async function () {
                let timestamp: BigNumber = startTimestamp;
                await expect(
                    await vestingWallet.vestedAmount(timestamp)
                ).to.be.equal(0)


                await expect(
                    await vestingWallet.vestedAmount(timestamp.sub(BigNumber.from(1)))
                ).to.be.equal(0)
            })

            it("timestamp between startTimestamp and endTimestamp", async function () {
                const interval = BigNumber.from(86400 / 2);

                let timestamp: BigNumber = startTimestamp;
                while (timestamp.lt(endTimestamp)) {
                    const expectedAmount = getReleasableAmount(
                        timestamp,
                        startTimestamp,
                        durationSeconds,
                        totalAllocation
                    );

                    expect(
                        await vestingWallet.vestedAmount(timestamp)
                    ).to.be.equal(
                        expectedAmount
                    )

                    timestamp = timestamp.add(interval);
                }
            })

            it("timestamp after endTimestamp", async function () {
                let timestamp: BigNumber = endTimestamp;
                expect(
                    await vestingWallet.vestedAmount(timestamp)
                ).to.be.equal(
                    totalAllocation
                )

                expect(
                    await vestingWallet.vestedAmount(endTimestamp.add(BigNumber.from(1)))
                ).to.be.equal(
                    totalAllocation
                )
            })
        });

        describe('#release available amount', async () => {
            it("permission deny", async function () {
                const error = `OwnableUnauthorizedAccount("${anyoneAddress}")`;
                await expect(
                    vestingWallet.connect(anyone).release()
                ).to.be.revertedWith(error)
            })

            it("insufficient balance", async function () {
                const error = `AddressInsufficientBalance("${vestingWallet.address}")`;
                await expect(
                    vestingWallet.connect(beneficiary).release()
                ).to.revertedWith(error)
            })

            it("release successful", async function () {
                let latestBlock = await ethers.provider.getBlock("latest");

                 // the estimate timestamp must be greater than the timestamp of the next block
                const estimateTimestamp = BigNumber.from(latestBlock.timestamp).add(60);

                // estimate available amount
                const estimateAmount = getReleasableAmount(
                    estimateTimestamp,
                    startTimestamp,
                    durationSeconds,
                    totalAllocation
                );

                // deposit estimated amount
                await deployer.sendTransaction({
                    to: vestingWallet.address,
                    value: estimateAmount
                });

                // release and calc actual released amount
                const curReleasedAmount = await vestingWallet.released();
                await vestingWallet.connect(beneficiary).release();
                const newReleasedAmount = await vestingWallet.released();
                const actualReleasedAmount = newReleasedAmount.sub(curReleasedAmount);


                latestBlock = await ethers.provider.getBlock("latest");
                const actualTimestamp = BigNumber.from(latestBlock.timestamp);
                const expectedReleasedAmount = getReleasableAmount(
                    actualTimestamp,
                    startTimestamp,
                    durationSeconds,
                    totalAllocation
                );

                // check released amount
                expect(
                    actualReleasedAmount
                ).to.be.equal(expectedReleasedAmount)

                // check balance
                expect(
                    await ethers.provider.getBalance(vestingWallet.address)
                ).to.be.equal(
                    estimateAmount.sub(expectedReleasedAmount)
                )
            })
        })

        describe('#release specific amount', async () => {
            it("permission deny", async function() {
                const error = `OwnableUnauthorizedAccount("${anyoneAddress}")`;
                await expect(
                    vestingWallet.connect(anyone).releaseSpecificAmount(0)
                ).to.revertedWith(error)
            })

            it("specific amount exceeded", async function () {
                const availableAmount = await vestingWallet.releasable();

                await expect(
                    vestingWallet.connect(beneficiary).releaseSpecificAmount(availableAmount.mul(BigNumber.from(2)))
                ).to.be.revertedWith(
                    "specific amount exceeds releasable()"
                )
            })

            it("insufficient balance", async function () {
                const error = `AddressInsufficientBalance("${vestingWallet.address}")`;
                await expect(
                    vestingWallet.connect(beneficiary).releaseSpecificAmount(1)
                ).to.be.revertedWith(error)
            })

            it("release successful", async function () {
                const latestBlock = await ethers.provider.getBlock("latest");
                const timestamp = BigNumber.from(latestBlock.timestamp);
                const estimateAmount = getReleasableAmount(
                    timestamp,
                    startTimestamp,
                    durationSeconds,
                    totalAllocation
                );

                // deposit estimated amount
                await anyone.sendTransaction({
                    to: vestingWallet.address,
                    value: estimateAmount
                });

                await expect(
                    await vestingWallet.connect(beneficiary).releaseSpecificAmount(estimateAmount)
                ).to.be.emit(
                    vestingWallet,
                    "EtherReleased"
                ).withArgs(
                    beneficiaryAddress,
                    estimateAmount
                )
            })
        })
    })

    describe("#Reclaim before the vesting schedule", function() {
        let deployer: Signer;
        let beneficiary: Signer;
        let anyone: Signer;

        let deployerAddress: Address;
        let beneficiaryAddress: Address;
        let anyoneAddress: Address;

        let vestingWallet: VestingWallet;

        const startTimestamp    = BigNumber.from(Math.ceil( Date.now() / 1000 ));
        const durationSeconds   = BigNumber.from(4 * 365 * 86400);
        const totalAllocation   = BigNumber.from(10).pow(27);

        before(async () => {
            [
                deployer,
                beneficiary,
                anyone,
                deployerAddress,
                beneficiaryAddress,
                anyoneAddress,
                vestingWallet
            ] = await deployContract(
                startTimestamp,
                durationSeconds,
                totalAllocation,
                0
            );
        });

        it("reclaim reject by invalid time", async function() {
            await expect(
                vestingWallet.connect(beneficiary).reclaim()
            ).to.be.revertedWith(
                "can only be called after the vesting schedule finishes"
            )
        })
    })

    describe("#Reclaim after the vesting schedule", function() {
        let deployer: Signer;
        let beneficiary: Signer;
        let anyone: Signer;

        let deployerAddress: Address;
        let beneficiaryAddress: Address;
        let anyoneAddress: Address;

        let vestingWallet: VestingWallet;

        // these parameters ensure all locked funds can be released after deployment.
        // startTimestamp + durationSeconds < now
        const startTimestamp    = BigNumber.from(Math.floor( Date.now() / 1000 ) - 10);
        const durationSeconds   = BigNumber.from(1);
        const totalAllocation   = BigNumber.from(10).pow(20);       // 100 eth

        beforeEach(async () => {
            [
                deployer,
                beneficiary,
                anyone,
                deployerAddress,
                beneficiaryAddress,
                anyoneAddress,
                vestingWallet
            ] = await deployContract(
                startTimestamp,
                durationSeconds,
                totalAllocation,
                0
            );
        });

        it("reclaim reject by permission deny", async function() {
            const error = `OwnableUnauthorizedAccount("${anyoneAddress}")`;
            await expect(
                vestingWallet.connect(anyone).reclaim()
            ).to.be.revertedWith(error)
        })

        // never released
        it("reclaim reject by never release", async function() {
            await expect(
                vestingWallet.connect(beneficiary).reclaim()
            ).to.be.revertedWith(
                "can only be called after all vested tokens are released"
            )
        })

        // partial released
        it("reclaim reject by partial release", async function() {
            const amount: BigNumber = totalAllocation.div(2);

            // deposit
            await anyone.sendTransaction({
                to: vestingWallet.address,
                value: amount
            });

            // release partial
            await expect(
                await vestingWallet.connect(beneficiary).releaseSpecificAmount(amount)
            ).to.be.emit(
                vestingWallet,
                "EtherReleased"
            ).withArgs(
                beneficiaryAddress,
                amount
            )

            // reclaim
            await expect(
                vestingWallet.connect(beneficiary).reclaim()
            ).to.be.revertedWith(
                "can only be called after all vested tokens are released"
            )
        })

        // fully released but no balance
        it("reclaim reject by zero balance", async function() {
            // deposit
            await anyone.sendTransaction({
                to: vestingWallet.address,
                value: totalAllocation
            });

            // release
            await expect(
                await vestingWallet.connect(beneficiary).release()
            ).to.be.emit(
                vestingWallet,
                "EtherReleased"
            ).withArgs(
                beneficiaryAddress,
                totalAllocation
            )

            // reclaim
            await expect(
                vestingWallet.connect(beneficiary).reclaim()
            ).to.be.revertedWith(
                "no balance left in the contract"
            )
        })

        // success reclaim
        it("reclaim successful", async function() {
            // deposit
            const depositAmount = totalAllocation.add(BigNumber.from(10).pow(19));
            await deployer.sendTransaction({
                to: vestingWallet.address,
                value: depositAmount
            });

            expect(
                await ethers.provider.getBalance(vestingWallet.address)
            ).to.be.equal(
                depositAmount
            )

            // fully released
            await expect(
                await vestingWallet.connect(beneficiary).release()
            ).to.be.emit(
                vestingWallet,
                "EtherReleased"
            ).withArgs(
                beneficiaryAddress,
                totalAllocation
            )

            // check balance
            const expectedBalance = depositAmount.sub(totalAllocation);
            expect(
                await ethers.provider.getBalance(vestingWallet.address)
            ).to.be.equal(
                expectedBalance
            )

            // reclaim
            await vestingWallet.connect(beneficiary).reclaim();

            // check balance
            expect(
                await ethers.provider.getBalance(vestingWallet.address)
            ).to.be.equal(0)
        })
    })
})